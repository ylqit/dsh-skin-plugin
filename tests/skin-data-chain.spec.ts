// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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
import type { SkinHostState, ThemeLayerV2 } from '../src/shared/contracts.ts'

const roots: string[] = []
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const GUIDES_ROOT = join(process.cwd(), 'guides')

afterEach(async () => {
  vi.useRealTimers()
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

function theme(name: string, asset = false): ThemeLayerV2 {
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

function archive(name: string, options: {
  asset?: boolean
  layer?: unknown
  assetHash?: string
  extra?: Zippable
  schemaVersion?: number
  themePartsVersion?: number
  themeSchemaVersion?: number
  assetPurpose?: 'backdrop' | 'preview' | 'component'
} = {}): Uint8Array {
  const withAsset = options.asset === true
  const files: Zippable = { ...(options.extra ?? {}) }
  const assets = withAsset
    ? [{
        path: 'assets/backdrop.png', mimeType: 'image/png',
        sha256: options.assetHash ?? createHash('sha256').update(PNG).digest('hex'), bytes: PNG.byteLength,
        purpose: options.assetPurpose ?? 'backdrop',
      }]
    : []
  files['manifest.json'] = strToU8(JSON.stringify({
    schemaVersion: options.schemaVersion ?? 3,
    id: name.toLowerCase(), name, version: '2.0.0', author: 'DSH Skin Test', tags: [],
    themePartsVersion: options.themePartsVersion ?? 2,
    capabilities: ['tokens', 'backdrop', 'component-parts'], assets,
  }))
  files['theme.json'] = strToU8(JSON.stringify({
    schemaVersion: options.themeSchemaVersion ?? 2,
    ...(options.layer ?? theme(name, withAsset)) as object,
  }))
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

class TestEventSource {
  static latest: TestEventSource | undefined
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(_url: string) {
    TestEventSource.latest = this
  }

  addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  }

  emit(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) listener()
  }

  close(): void {}
}

describe('overlay skin data chain', () => {
  it('accepts only schema v3 with Theme Parts v2', () => {
    expect(parseSkinArchive(archive('Current')).manifest.schemaVersion).toBe(3)
    expect(() => parseSkinArchive(archive('LegacyV1', {
      schemaVersion: 1, themePartsVersion: 1, themeSchemaVersion: 1,
    }))).toThrow(/schemaVersion.*3/)
    expect(() => parseSkinArchive(archive('LegacyV2', {
      schemaVersion: 2, themePartsVersion: 1, themeSchemaVersion: 1,
    }))).toThrow(/schemaVersion.*3/)
    expect(() => parseSkinArchive(archive('OldParts', { themePartsVersion: 1 }))).toThrow(/themePartsVersion.*2/)
    expect(() => parseSkinArchive(archive('OldTheme', { themeSchemaVersion: 1 }))).toThrow(/theme\.json\.schemaVersion.*2/)
  })

  it.each([1, 2])('rejects schema v%s with zero persistence and zero state change', async (schemaVersion) => {
    const store = await library()
    const current = await store.library.import(archive('CurrentState'))
    await store.library.commit(store.library.prepare(current.fingerprint).preparationId)
    const beforeState = store.library.snapshot()
    const beforeFiles = await readdir(store.root)
    await expect(store.library.import(archive(`Rejected${String(schemaVersion)}`, {
      schemaVersion, themePartsVersion: 1, themeSchemaVersion: 1,
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' })
    expect(store.library.snapshot()).toEqual(beforeState)
    expect(await readdir(store.root)).toEqual(beforeFiles)
  })

  it('returns stable protocol and asset error codes', () => {
    try {
      parseSkinArchive(archive('Legacy', { schemaVersion: 2, themePartsVersion: 1, themeSchemaVersion: 1 }))
      throw new Error('legacy archive unexpectedly parsed')
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNSUPPORTED_PROTOCOL', field: 'manifest.json.schemaVersion' })
    }
    try {
      parseSkinArchive(archive('Forged', { asset: true, assetHash: '0'.repeat(64) }))
      throw new Error('forged archive unexpectedly parsed')
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_ASSET' })
    }
    try {
      parseSkinArchive(archive('UnsafeEntry', { extra: { 'theme.css': strToU8('*{}') } }))
      throw new Error('unsafe archive unexpectedly parsed')
    } catch (error) {
      expect(error).toMatchObject({ code: 'SECURITY_LIMIT' })
    }
    try {
      parseSkinArchive(archive('InvalidPart', { layer: { tokens: {}, partStyles: [{ part: 'unknown.part', style: { light: {}, dark: {} } }] } }))
      throw new Error('invalid archive unexpectedly parsed')
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_ARCHIVE' })
    }
  })

  it('rewrites and compiles a declared component surface image', () => {
    const parsed = parseSkinArchive(archive('SurfaceImage', {
      asset: true,
      assetPurpose: 'component',
      layer: {
        tokens: {},
        partStyles: [{
          part: 'conversation.message',
          style: {
            light: { surfaceImage: { assetUrl: 'asset:assets/backdrop.png', fit: 'cover', positionX: 0.25, positionY: 0.75 } },
            dark: { surfaceImage: { assetUrl: 'asset:assets/backdrop.png', fit: 'contain', positionX: 0.5, positionY: 0.5 } },
          },
        }],
      },
    }))
    const image = parsed.layer.partStyles?.[0]?.style.light.surfaceImage
    expect(image?.assetUrl).toMatch(/^\/api\/dsh-skin\/assets\/[a-f0-9]{64}\/backdrop\.png$/)
    expect(compileThemeLayerCss(parsed.layer)).toContain(`background-image:url("${image?.assetUrl}")`)
    expect(compileThemeLayerCss(parsed.layer)).toContain('background-position:25% 75%')
    expect(compileThemeLayerCss(parsed.layer)).toContain('background-size:cover')
  })

  it('keeps Host and Client CSS identical through immutable import and Preview-to-Active commit', async () => {
    const store = await library()
    const first = await store.library.import(archive('Aurora', { asset: true }))
    const second = await store.library.import(archive('Nebula'))
    const firstCommit = await store.library.commit(store.library.prepare(first.fingerprint).preparationId)
    expect(firstCommit.activationRevision).toBe(1)
    await expect(readFile(join(store.root, 'state-v3.json'), 'utf8')).resolves.toContain(first.fingerprint)
    await expect(readFile(join(store.root, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

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

  it('loads v3 built-ins and exposes their component experiences', async () => {
    const builtinsRoot = join(process.cwd(), 'builtins')
    const parsed = await Promise.all([
      'pikachu-energy.dshskin', 'squirtle-water.dshskin', 'bulbasaur-growth.dshskin',
    ].map(async name => parseSkinArchive(new Uint8Array(await readFile(join(builtinsRoot, name))))))
    expect(parsed.map(skin => skin.manifest.schemaVersion)).toEqual([3, 3, 3])
    expect(parsed.map(skin => skin.manifest.version)).toEqual(['2.0.0', '2.0.0', '2.0.0'])
    expect(parsed.every(skin => skin.preview !== undefined && skin.experience !== undefined)).toBe(true)
    expect(parsed[0]?.experience?.placements).toEqual(['skin.shell.top', 'skin.shell.floating'])
    expect(parsed[1]?.experience?.placements).toEqual(['skin.shell.bottom', 'skin.shell.floating'])
    expect(parsed[2]?.experience?.placements).toEqual(['skin.sidebar.brand', 'skin.conversation.hero'])
    expect(parsed[0]?.layer.partStyles?.map(rule => [rule.part, rule.variant, rule.state])).toEqual(expect.arrayContaining([
      ['conversation.composer', undefined, undefined],
      ['conversation.message', 'user', undefined],
      ['primitive.dialog-surface', undefined, undefined],
    ]))
    expect(parsed[1]?.layer.partStyles?.map(rule => [rule.part, rule.variant, rule.state])).toEqual(expect.arrayContaining([
      ['primitive.input-control', undefined, undefined],
      ['conversation.message', 'assistant', undefined],
      ['tool.card', 'default', 'running'],
    ]))
    expect(parsed[2]?.layer.partStyles?.map(rule => [rule.part, rule.variant, rule.state])).toEqual(expect.arrayContaining([
      ['shell.sidebar', undefined, undefined],
      ['conversation.composer', undefined, undefined],
      ['settings.row', undefined, 'selected'],
    ]))
    for (const skin of parsed) {
      expect(skin.layer.backdrop?.light.assetUrl).not.toBe(skin.layer.backdrop?.dark.assetUrl)
      expect(Object.values(skin.layer.tokens).some(pair => pair?.light !== pair?.dark)).toBe(true)
    }

    const store = await library(builtinsRoot)
    const skins = store.library.snapshot().skins
    expect(skins).toHaveLength(3)
    expect(skins.every(skin => skin.source === 'builtin')).toBe(true)
    await expect(store.library.delete(skins[0]!.fingerprint)).rejects.toThrow('built-in skins cannot be deleted')

    const first = skins.find(skin => skin.id === 'pikachu-energy')!
    const second = skins.find(skin => skin.id === 'squirtle-water')!
    expect(store.library.draft(first.fingerprint)).toMatchObject({
      fingerprint: first.fingerprint,
      source: 'builtin',
      manifest: { schemaVersion: 3, id: 'pikachu-energy', version: '2.0.0' },
      experience: first.experience,
    })
    await store.library.commit(store.library.prepare(first.fingerprint).preparationId)
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

    const experience = {
      install: vi.fn(async () => {}),
      clear: vi.fn(),
      setMode: vi.fn(),
    }
    const controller = new SkinStudioController(themeService(), true, experience)
    const dispose = controller.start()
    await vi.waitFor(() => { expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe(first.fingerprint) })
    expect(experience.install).toHaveBeenCalledWith(first.experience, first.fingerprint)
    controller.activate(second.fingerprint)
    await vi.waitFor(() => { expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe(second.fingerprint) })
    expect(experience.install).toHaveBeenCalledWith(second.experience, second.fingerprint)
    expect(store.library.snapshot().activationRevision).toBe(2)
    dispose()
    expect(experience.clear).toHaveBeenCalled()
    expect(activeStyle()).toBeNull()
  })

  it('edits a built-in as a lossless local v3 copy with assets and Experience intact', async () => {
    const store = await library(join(process.cwd(), 'builtins'))
    const builtin = store.library.snapshot().skins.find(skin => skin.id === 'pikachu-energy')!
    const original = store.library.draft(builtin.fingerprint)
    let uploaded: Uint8Array | undefined
    installInstantImages()
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith(`/skins/${builtin.fingerprint}`)) return envelope(original)
      if (path.includes(`/assets/${builtin.fingerprint}/`)) {
        const filename = path.slice(path.lastIndexOf('/') + 1)
        const asset = store.library.asset(builtin.fingerprint, filename)
        return new Response(asset.bytes, { headers: { 'Content-Type': asset.mimeType } })
      }
      if (path === original.experience?.url) {
        const experience = store.library.experience(builtin.fingerprint)
        return new Response(experience.bytes, { headers: { 'Content-Type': 'text/javascript' } })
      }
      if (path.endsWith('/import')) {
        uploaded = init?.body as Uint8Array
        return envelope(await store.library.import(uploaded), 201)
      }
      if (path.endsWith('/state')) return envelope(store.library.snapshot())
      throw new Error(`unexpected test request ${path}`)
    }))

    const controller = new SkinStudioController(themeService(), true)
    controller.beginDraft(builtin.fingerprint)
    await vi.waitFor(() => { expect(controller.getSnapshot().draftName).toContain('副本') })
    controller.updateToken('--dsw-alias-brand-primary', 'light', '#ffd400')
    controller.saveDraft()
    await vi.waitFor(() => { expect(uploaded).toBeInstanceOf(Uint8Array) })

    const copy = parseSkinArchive(uploaded!)
    expect(copy.manifest).toMatchObject({
      schemaVersion: 3,
      id: 'pikachu-energy-custom',
      name: expect.stringContaining('副本'),
      version: '2.0.0',
      author: original.manifest.author,
      description: original.manifest.description,
      tags: original.manifest.tags,
      experience: {
        moduleId: original.manifest.experience?.moduleId,
        placements: original.manifest.experience?.placements,
      },
    })
    expect(copy.manifest.assets).toHaveLength(original.manifest.assets.length)
    expect(copy.experience).toBeDefined()
    await vi.waitFor(() => {
      expect(store.library.snapshot().skins.some(skin => skin.source === 'local' && skin.fingerprint === copy.fingerprint)).toBe(true)
    })
  })

  it('resumes the same draft Theme Layer and Experience without resetting its history', async () => {
    const fingerprint = '9'.repeat(64)
    const descriptor = {
      apiVersion: 1 as const,
      moduleId: 'dsh-skin:00000000-0000-4000-8000-000000000009',
      url: `/api/dsh-skin/experience/${fingerprint}/client.js`,
      rev: fingerprint,
      placements: ['skin.shell.floating'] as const,
      assets: {},
    }
    const layer = theme('Resume')
    const source = {
      fingerprint,
      source: 'local' as const,
      manifest: {
        schemaVersion: 3 as const,
        id: 'resume-draft', name: 'Resume Draft', version: '2.0.0', tags: [],
        themePartsVersion: 2 as const, capabilities: ['tokens', 'component-experience'] as const, assets: [],
        experience: {
          apiVersion: 1 as const, moduleId: descriptor.moduleId, entry: 'experience/client.js' as const,
          sha256: '0'.repeat(64), bytes: 17, placements: descriptor.placements,
        },
      },
      layer,
      experience: descriptor,
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const path = String(input)
      if (path.endsWith(`/skins/${fingerprint}`)) return envelope(source)
      if (path === descriptor.url) return new Response('export default {}')
      throw new Error(`unexpected test request ${path}`)
    }))
    const experience = { install: vi.fn(async () => {}), clear: vi.fn(), setMode: vi.fn() }
    const controller = new SkinStudioController(themeService(), true, experience)

    controller.beginDraft(fingerprint)
    await vi.waitFor(() => { expect(controller.getSnapshot().previewing).toBe(true) })
    controller.updateToken('--dsw-alias-brand-primary', 'light', '#4f8f3a')
    controller.updateToken('--dsw-alias-brand-primary', 'light', '#5fa34a')
    controller.undo()
    const before = structuredClone(controller.getSnapshot())
    expect(before.canUndo).toBe(true)
    expect(before.canRedo).toBe(true)

    controller.cancelPreview()
    expect(controller.getSnapshot().previewing).toBe(false)
    expect(previewStyle()).toBeNull()
    controller.undo()
    expect(controller.getSnapshot().previewing).toBe(false)
    expect(previewStyle()).toBeNull()
    controller.redo()
    expect(controller.getSnapshot()).toMatchObject({ draft: before.draft, canUndo: true, canRedo: true, previewing: false })
    experience.install.mockClear()

    controller.resumePreview()
    await vi.waitFor(() => { expect(controller.getSnapshot().previewing).toBe(true) })
    expect(controller.getSnapshot()).toMatchObject({
      draft: before.draft,
      draftName: before.draftName,
      dirty: before.dirty,
      canUndo: before.canUndo,
      canRedo: before.canRedo,
      changes: before.changes,
    })
    expect(previewStyle()?.textContent).toContain('#4f8f3a')
    expect(experience.install).toHaveBeenLastCalledWith(descriptor, fingerprint)
  })

  it('keeps component assets when backdrop images are replaced in Studio', async () => {
    let uploaded: Uint8Array | undefined
    installInstantImages()
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/import')) { uploaded = init?.body as Uint8Array; return envelope({ imported: true }, 201) }
      if (path.endsWith('/state')) return envelope({ activationRevision: 0, skins: [] } satisfies SkinHostState)
      throw new Error(`unexpected test request ${path}`)
    }))
    const image = (name: string): File => new NodeFile([PNG], name, { type: 'image/png' }) as unknown as File
    const controller = new SkinStudioController(themeService(), true)
    controller.updatePartSurfaceImage('conversation.message', '', '', 'light', image('surface.png'))
    await vi.waitFor(() => { expect(controller.getSnapshot().busy).toBe(false) })
    expect(controller.getSnapshot().error).toBeUndefined()
    expect(controller.getSnapshot().draft.partStyles?.find(rule => rule.part === 'conversation.message' && rule.variant === undefined)?.style.light.surfaceImage).toBeDefined()
    controller.updateBackdropImage('light', image('light.png'))
    controller.updateBackdropImage('dark', image('dark.png'))
    await vi.waitFor(() => { expect(controller.getSnapshot().busy).toBe(false) })
    controller.saveDraft()
    await vi.waitFor(() => { expect(uploaded).toBeInstanceOf(Uint8Array) })
    const parsed = parseSkinArchive(uploaded!)
    expect(parsed.manifest.assets.some(asset => asset.purpose === 'component')).toBe(true)
    expect(parsed.manifest.assets.filter(asset => asset.purpose === 'backdrop')).toHaveLength(2)
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
    }, store.library, GUIDES_ROOT)
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

  it('returns stable import errors through the Host API', async () => {
    const store = await library()
    let handler: Parameters<SkinWebServer['register']>[0]['handler'] | undefined
    registerSkinHttp({
      register: route => { handler = route.handler; return () => {} },
      tapIndex: () => () => {},
    }, store.library, GUIDES_ROOT)
    const bytes = archive('LegacyApi', { schemaVersion: 2, themePartsVersion: 1, themeSchemaVersion: 1 })
    const request = Readable.from([Buffer.from(bytes)])
    Object.assign(request, {
      method: 'POST',
      url: '/api/dsh-skin/import',
      headers: { 'content-length': String(bytes.byteLength), host: '127.0.0.1' },
    })
    Object.defineProperty(request, 'socket', { value: { remoteAddress: '127.0.0.1' } })
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

    expect(status).toBe(400)
    expect(JSON.parse(body)).toMatchObject({
      ok: false,
      error: expect.stringContaining('schemaVersion'),
      code: 'UNSUPPORTED_PROTOCOL',
      field: 'manifest.json.schemaVersion',
    })
  })

  it('keeps SSE connections alive and stops heartbeats on Host unload', async () => {
    vi.useFakeTimers()
    const store = await library()
    let handler: Parameters<SkinWebServer['register']>[0]['handler'] | undefined
    const writes: string[] = []
    const dispose = registerSkinHttp({
      register: route => { handler = route.handler; return () => {} },
      tapIndex: () => () => {},
    }, store.library, GUIDES_ROOT)
    const request = {
      method: 'GET', url: '/api/dsh-skin/events', headers: {},
      once: vi.fn(),
    }
    const response = {
      headersSent: false,
      writeHead() { this.headersSent = true; return this },
      write(value: string) { writes.push(value); return true },
      end: vi.fn(),
    }
    if (handler === undefined) throw new Error('skin handler was not registered')
    await handler(request as never, response as never)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(writes.some(value => value.startsWith(': heartbeat'))).toBe(true)
    dispose()
    const count = writes.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(writes).toHaveLength(count)
  })

  it('surfaces local-management denial in controller state without issuing a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new SkinStudioController(themeService(), false)
    controller.restoreDefault()
    await vi.waitFor(() => { expect(controller.getSnapshot().error).toContain('Host 本机') })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('restores one Part or property without hiding the DSH component and supports undo/redo', () => {
    const controller = new SkinStudioController(themeService(), true)
    controller.upsertPartRule('primitive.button', 'primary', '', 'opacity', '0.7', '0.8')
    expect(controller.getSnapshot()).toMatchObject({ dirty: true, canUndo: true })
    expect(controller.getSnapshot().draft.partStyles?.find(rule => rule.part === 'primitive.button')?.style.light.opacity).toBe(0.7)

    controller.resetPartProperty('primitive.button', 'primary', '', 'opacity')
    expect(controller.getSnapshot().draft.partStyles?.find(rule => rule.part === 'primitive.button')?.style.light.opacity).toBeUndefined()
    controller.undo()
    expect(controller.getSnapshot().draft.partStyles?.find(rule => rule.part === 'primitive.button')?.style.light.opacity).toBe(0.7)
    controller.redo()
    expect(controller.getSnapshot().draft.partStyles?.find(rule => rule.part === 'primitive.button')?.style.light.opacity).toBeUndefined()

    controller.setPartEnabled('primitive.button', false)
    expect(controller.getSnapshot().draft.partStyles?.some(rule => rule.part === 'primitive.button')).toBe(false)
    expect(controller.getSnapshot().draft.partStyles?.some(rule => rule.part === 'conversation.composer')).toBe(true)
    expect(previewStyle()?.textContent ?? '').not.toContain('display:none')
    controller.setPartEnabled('primitive.button', true)
    expect(controller.getSnapshot().draft.partStyles?.some(rule => rule.part === 'primitive.button')).toBe(true)
  })

  it('refreshes state when a new SSE connection sends its ready event', async () => {
    const host: SkinHostState = { activationRevision: 0, skins: [] }
    vi.stubGlobal('EventSource', TestEventSource)
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ ...host })))
    const controller = new SkinStudioController(themeService(), true)
    const dispose = controller.start()

    await vi.waitFor(() => { expect(controller.getSnapshot().host?.activationRevision).toBe(0) })
    host.activationRevision = 4
    TestEventSource.latest?.emit('ready')
    await vi.waitFor(() => { expect(controller.getSnapshot().host?.activationRevision).toBe(4) })
    dispose()
  })

  it('does not let a slow image from an older refresh replace a newer skin', async () => {
    const slow = theme('Slow', true)
    const fast = theme('Fast', true)
    slow.backdrop!.light.assetUrl = `/api/dsh-skin/assets/${'a'.repeat(64)}/slow.png`
    slow.backdrop!.dark.assetUrl = `/api/dsh-skin/assets/${'a'.repeat(64)}/slow.png`
    fast.backdrop!.light.assetUrl = `/api/dsh-skin/assets/${'b'.repeat(64)}/fast.png`
    fast.backdrop!.dark.assetUrl = `/api/dsh-skin/assets/${'b'.repeat(64)}/fast.png`
    const states: SkinHostState[] = [
      { activationRevision: 1, activeFingerprint: 'a'.repeat(64), activeLayer: slow, skins: [] },
      { activationRevision: 2, activeFingerprint: 'b'.repeat(64), activeLayer: fast, skins: [] },
    ]
    let stateRequest = 0
    let finishSlow: (() => void) | undefined
    class DeferredImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(value: string) {
        if (value.includes('slow')) finishSlow = () => { this.onload?.() }
        else queueMicrotask(() => { this.onload?.() })
      }
    }
    vi.stubGlobal('Image', DeferredImage)
    vi.stubGlobal('EventSource', TestEventSource)
    vi.stubGlobal('fetch', vi.fn(async () => envelope(states[Math.min(stateRequest++, states.length - 1)])))
    const controller = new SkinStudioController(themeService(), true)
    const dispose = controller.start()

    await vi.waitFor(() => { expect(controller.getSnapshot().host?.activationRevision).toBe(1) })
    TestEventSource.latest?.emit('ready')
    await vi.waitFor(() => {
      expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe('b'.repeat(64))
    })
    finishSlow?.()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(activeStyle()?.getAttribute('data-dsh-skin-fingerprint')).toBe('b'.repeat(64))
    dispose()
  })

  it('preloads controlled component surface images before presenting a skin', async () => {
    const layer = theme('SurfacePreload')
    layer.partStyles = [{
      part: 'conversation.message',
      style: {
        light: { surfaceImage: { assetUrl: `/api/dsh-skin/assets/${'c'.repeat(64)}/surface.png`, fit: 'cover', positionX: 0.5, positionY: 0.5 } },
        dark: { surfaceImage: { assetUrl: `/api/dsh-skin/assets/${'c'.repeat(64)}/surface.png`, fit: 'cover', positionX: 0.5, positionY: 0.5 } },
      },
    }]
    let finish: (() => void) | undefined
    class DeferredImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { finish = () => { this.onload?.() } }
    }
    vi.stubGlobal('Image', DeferredImage)
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => envelope({
      activationRevision: 1, activeFingerprint: 'c'.repeat(64), activeLayer: layer, skins: [],
    } satisfies SkinHostState)))
    const controller = new SkinStudioController(themeService(), true)
    const dispose = controller.start()
    await vi.waitFor(() => { expect(controller.getSnapshot().host?.activationRevision).toBe(1) })
    expect(activeStyle()).toBeNull()
    finish?.()
    await vi.waitFor(() => { expect(activeStyle()).not.toBeNull() })
    dispose()
  })

  it('cancels preparation and restores the previous presentation when Experience activation fails', async () => {
    const fingerprint = 'f'.repeat(64)
    const experience = {
      install: vi.fn(async () => { throw new Error('broken experience') }),
      clear: vi.fn(),
      setMode: vi.fn(),
    }
    const cancel = vi.fn()
    vi.stubGlobal('EventSource', undefined)
    installInstantImages()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const path = String(input)
      if (path.endsWith('/prepare')) return envelope({
        preparationId: 'prepared', fingerprint, activationRevision: 0, layer: theme('Prepared'),
        experience: {
          apiVersion: 1, moduleId: 'dsh-skin:00000000-0000-4000-8000-000000000000',
          url: `/api/dsh-skin/experience/${fingerprint}/client.js`, rev: fingerprint,
          placements: ['skin.shell.floating'], assets: {},
        },
      })
      if (path.endsWith('/cancel')) { cancel(); return envelope({ cancelled: true }) }
      throw new Error(`unexpected test request ${path}`)
    }))
    const controller = new SkinStudioController(themeService(), true, experience)
    controller.activate(fingerprint)
    await vi.waitFor(() => { expect(controller.getSnapshot().error).toContain('broken experience') })
    expect(cancel).toHaveBeenCalledOnce()
    expect(previewStyle()).toBeNull()
  })
})
