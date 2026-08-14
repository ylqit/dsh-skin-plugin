// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileThemeLayerCss, themeLayerFingerprint } from '../src/shared/theme-layer.ts'
import { parseSkinArchive } from '../src/host/archive.ts'
import { registerSkinHttp, type SkinWebServer } from '../src/host/http.ts'
import { SkinLibrary } from '../src/host/library.ts'
import { SkinStudioController } from '../src/client/controller.ts'
import type { ThemeService } from '../src/client/contracts.ts'
import type { ThemeLayerDefinition } from '../src/shared/contracts.ts'

const roots: string[] = []
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const style of document.querySelectorAll('style[data-dsh-skin]')) style.remove()
  delete document.body.dataset.dshSkinActive
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

async function library(builtinsRoot?: string): Promise<{ library: SkinLibrary; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skin-plugin-'))
  roots.push(root)
  return { library: await SkinLibrary.open(join(root, 'skins'), undefined, builtinsRoot), root: join(root, 'skins') }
}

function installInstantImages(): void {
  class InstantImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => { this.onload?.() }) }
  }
  vi.stubGlobal('Image', InstantImage)
}

function themeService(): ThemeService {
  return {
    getTheme: () => ({ active: { colorScheme: 'light' } }),
    setTheme: vi.fn(),
  }
}

function theme(name: string, asset = false): ThemeLayerDefinition {
  const offset = name.charCodeAt(0) % 10
  const backdrop = {
    light: {
      ...(asset ? { assetUrl: 'asset:assets/backdrop.png' } : {}),
      fallbackColor: '#f4f7fb', focusX: 0.4, focusY: 0.6, dim: 0.1, blurPx: offset,
    },
    dark: {
      ...(asset ? { assetUrl: 'asset:assets/backdrop.png' } : {}),
      fallbackColor: '#0b1020', focusX: 0.6, focusY: 0.4, dim: 0.3, blurPx: offset,
    },
  }
  return {
    tokens: {
      '--dsw-alias-bg-base': { light: '#f4f7fb', dark: '#0b1020' },
      '--dsw-alias-brand-primary': { light: '#315efb', dark: '#7c9cff' },
    },
    backdrop,
    partStyles: [{
      part: 'primitive.button', variant: 'primary',
      style: {
        light: { background: { token: '--dsw-alias-brand-primary' }, borderRadiusPx: 12 + offset },
        dark: { background: '#7c9cff', borderRadiusPx: 12 + offset },
      },
    }],
  }
}

function archive(name: string, options: { asset?: boolean; layer?: unknown; assetHash?: string; extra?: Zippable } = {}): Uint8Array {
  const withAsset = options.asset === true
  const files: Zippable = { ...(options.extra ?? {}) }
  const assets = withAsset
    ? [{
        path: 'assets/backdrop.png', mimeType: 'image/png',
        sha256: options.assetHash ?? createHash('sha256').update(PNG).digest('hex'), bytes: PNG.byteLength,
      }]
    : []
  files['manifest.json'] = strToU8(JSON.stringify({
    schemaVersion: 1, id: name.toLowerCase(), name, version: '1.0.0', themePartsVersion: 1,
    capabilities: ['tokens', 'backdrop', 'component-parts'], assets,
  }))
  files['theme.json'] = strToU8(JSON.stringify({ schemaVersion: 1, ...(options.layer ?? theme(name, withAsset)) as object }))
  if (withAsset) files['assets/backdrop.png'] = PNG
  return zipSync(files, { level: 9 })
}

function envelope(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, value }), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

function activeStyle(): HTMLStyleElement | null {
  return document.querySelector('style[data-dsh-skin="active"]')
}

function previewStyle(): HTMLStyleElement | null {
  return document.querySelector('style[data-dsh-skin="preview"]')
}

describe('overlay skin data chain', () => {
  it('keeps Host and Client CSS identical through immutable import and Preview-to-Active commit', async () => {
    const store = await library()
    const first = await store.library.import(archive('Aurora', { asset: true }))
    const second = await store.library.import(archive('Nebula'))
    const firstCommit = await store.library.commit(store.library.prepare(first.fingerprint).preparationId)
    expect(firstCommit.activationRevision).toBe(1)

    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/state')) return envelope(store.library.snapshot())
      if (path.endsWith('/prepare')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { fingerprint?: string }
        return envelope(store.library.prepare(body.fingerprint))
      }
      if (path.endsWith('/commit')) {
        const body = JSON.parse(String(init?.body)) as { preparationId: string }
        return envelope(await store.library.commit(body.preparationId))
      }
      if (path.endsWith('/cancel')) return envelope({ cancelled: true })
      throw new Error(`unexpected test request ${path}`)
    }))

    installInstantImages()
    const controller = new SkinStudioController(themeService(), true)
    const dispose = controller.start()
    await vi.waitFor(() => { expect(controller.getSnapshot().host?.activeFingerprint).toBe(first.fingerprint) })
    await vi.waitFor(() => { expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe(first.fingerprint) })
    expect(activeStyle()?.textContent).toBe(compileThemeLayerCss(firstCommit.layer))
    expect(themeLayerFingerprint(firstCommit.layer)).toBe(themeLayerFingerprint(store.library.snapshot().activeLayer))
    expect(compileThemeLayerCss(firstCommit.layer)).toBe(compileThemeLayerCss(store.library.snapshot().activeLayer))

    controller.activate(second.fingerprint)
    await vi.waitFor(() => { expect(controller.getSnapshot().host?.activeFingerprint).toBe(second.fingerprint) })
    expect(store.library.snapshot()).toMatchObject({ activeFingerprint: second.fingerprint, activationRevision: 2 })
    await vi.waitFor(() => { expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe(second.fingerprint) })
    expect(previewStyle()).toBeNull()
    dispose()
    expect(activeStyle()).toBeNull()
    expect(document.body.dataset.dshSkinActive).toBeUndefined()
  })

  it('recovers a missing Active Skin to previousConfirmed, then persists a higher revision', async () => {
    const store = await library()
    const first = await store.library.import(archive('Fallback'))
    const second = await store.library.import(archive('Current'))
    await store.library.commit(store.library.prepare(first.fingerprint).preparationId)
    await store.library.commit(store.library.prepare(second.fingerprint).preparationId)
    await rm(join(store.root, second.fingerprint), { recursive: true })

    const warnings: unknown[] = []
    const reopened = await SkinLibrary.open(store.root, error => { warnings.push(error) })
    expect(reopened.snapshot()).toMatchObject({
      activeFingerprint: first.fingerprint,
      activationRevision: 3,
    })
    expect(warnings).toHaveLength(1)
  })

  it('loads v2 built-ins and switches overlay presentation without dynamic module loads', async () => {
    const builtinsRoot = join(process.cwd(), 'builtins')
    const parsed = await Promise.all([
      'pikachu-energy.dshskin', 'squirtle-water.dshskin', 'bulbasaur-growth.dshskin',
    ].map(async name => parseSkinArchive(new Uint8Array(await readFile(join(builtinsRoot, name))))))
    expect(parsed.map(skin => skin.manifest.schemaVersion)).toEqual([2, 2, 2])
    expect(parsed.every(skin => skin.preview !== undefined && skin.experience !== undefined)).toBe(true)

    const store = await library(builtinsRoot)
    const skins = store.library.snapshot().skins
    expect(skins).toHaveLength(3)
    expect(skins.every(skin => skin.source === 'builtin')).toBe(true)
    await expect(store.library.delete(skins[0]!.fingerprint)).rejects.toThrow('built-in skins cannot be deleted')

    const first = skins.find(skin => skin.id === 'pikachu-energy')!
    const second = skins.find(skin => skin.id === 'squirtle-water')!
    await store.library.commit(store.library.prepare(first.fingerprint).preparationId)
    // Experience descriptors stay stored for future contract-capable harnesses,
    // but overlay mode never fetches or executes them.
    expect(store.library.snapshot().activeExperience?.moduleId).toBe(first.experience?.moduleId)

    vi.stubGlobal('EventSource', undefined)
    installInstantImages()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/state')) return envelope(store.library.snapshot())
      if (path.endsWith('/prepare')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { fingerprint?: string }
        return envelope(store.library.prepare(body.fingerprint))
      }
      if (path.endsWith('/commit')) {
        const body = JSON.parse(String(init?.body)) as { preparationId: string }
        return envelope(await store.library.commit(body.preparationId))
      }
      throw new Error(`unexpected test request ${path}`)
    }))

    const controller = new SkinStudioController(themeService(), true)
    const dispose = controller.start()
    await vi.waitFor(() => { expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe(first.fingerprint) })
    controller.activate(second.fingerprint)
    await vi.waitFor(() => { expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe(second.fingerprint) })
    expect(store.library.snapshot().activationRevision).toBe(2)
    dispose()
    expect(activeStyle()).toBeNull()
  })

  it.each([
    ['path traversal', () => archive('Unsafe', { extra: { '../theme.css': strToU8('x') } })],
    ['arbitrary CSS entry', () => archive('Unsafe', { extra: { 'theme.css': strToU8('*{}') } })],
    ['forged asset hash', () => archive('Unsafe', { asset: true, assetHash: '0'.repeat(64) })],
    ['unknown Part', () => archive('Unsafe', { layer: { tokens: {}, partStyles: [{ part: 'private.card', style: { light: {}, dark: {} } }] } })],
    ['selector-shaped field', () => archive('Unsafe', { layer: { tokens: {}, selector: 'body *' } })],
    ['unsafe URL', () => archive('Unsafe', { layer: { ...theme('Unsafe'), backdrop: { ...theme('Unsafe').backdrop, light: { ...theme('Unsafe').backdrop!.light, assetUrl: 'https://evil.invalid/x' } } } })],
  ])('rejects %s before persistence', (_name, make) => {
    expect(() => parseSkinArchive(make())).toThrow(TypeError)
  })

  it('rejects compressed expansion bombs and non-loopback management requests', async () => {
    const bomb = zipSync({ 'bomb.bin': new Uint8Array(5 * 1024 * 1024) }, { level: 9 })
    expect(() => parseSkinArchive(bomb)).toThrow(/compression-ratio|expands beyond/)

    const store = await library()
    let handler: Parameters<SkinWebServer['register']>[0]['handler'] | undefined
    registerSkinHttp({
      register: route => { handler = route.handler; return () => {} },
      tapIndex: () => () => {},
    }, store.library)
    const request = Readable.from([Buffer.from('{}')])
    Object.assign(request, { method: 'POST', url: '/api/dsh-skin/prepare', headers: {} })
    Object.defineProperty(request, 'socket', { value: { remoteAddress: '203.0.113.10' } })
    let status = 0
    let body = ''
    const response = {
      headersSent: false,
      writeHead(code: number) { status = code; this.headersSent = true; return this },
      end(chunk?: Uint8Array) { if (chunk !== undefined) body += Buffer.from(chunk).toString('utf8') },
      write() { return true },
    }
    if (handler === undefined) throw new Error('skin handler was not registered')
    await handler(request as never, response as never)
    expect(status).toBe(403)
    expect(JSON.parse(body)).toMatchObject({ ok: false, error: expect.stringContaining('Host machine') })
  })

  it('surfaces local-management denial in controller state without issuing a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new SkinStudioController(themeService(), false)
    controller.restoreDefault()
    await vi.waitFor(() => { expect(controller.getSnapshot().error).toContain('Host 本机') })
    expect(fetch).not.toHaveBeenCalled()
  })
})
