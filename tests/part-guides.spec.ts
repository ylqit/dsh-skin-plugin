import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { registerSkinHttp, type SkinWebServer } from '../src/host/http.ts'
import { SkinLibrary } from '../src/host/library.ts'
import { PART_GUIDE_FILENAMES, THEME_PART_GUIDES } from '../src/shared/part-guides.ts'
import { THEME_PART_CATALOG } from '../src/shared/theme-layer.ts'

const roots: string[] = []
const guidesRoot = join(process.cwd(), 'guides')

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

describe('Theme Parts v2 guide catalog', () => {
  it('covers every registered part with valid real-image highlights', () => {
    expect(PART_GUIDE_FILENAMES).toEqual([
      'shell.webp', 'conversation.webp', 'details.webp', 'menu.webp',
      'dialog.webp', 'tooltip.webp', 'settings.webp',
    ])
    expect(Object.keys(THEME_PART_GUIDES).sort()).toEqual(Object.keys(THEME_PART_CATALOG).sort())
    expect(Object.keys(THEME_PART_GUIDES)).toHaveLength(Object.keys(THEME_PART_CATALOG).length)

    for (const [part, guide] of Object.entries(THEME_PART_GUIDES)) {
      expect(guide.label, part).not.toBe('')
      expect(['框架', '会话', '基础控件', '菜单与弹窗', '工具', '设置'], part).toContain(guide.group)
      expect(guide.purpose, part).not.toBe('')
      expect(PART_GUIDE_FILENAMES, part).toContain(guide.filename)
      expect(guide.highlight.x, part).toBeGreaterThanOrEqual(0)
      expect(guide.highlight.y, part).toBeGreaterThanOrEqual(0)
      expect(guide.highlight.width, part).toBeGreaterThan(0)
      expect(guide.highlight.height, part).toBeGreaterThan(0)
      expect(guide.highlight.x + guide.highlight.width, part).toBeLessThanOrEqual(1)
      expect(guide.highlight.y + guide.highlight.height, part).toBeLessThanOrEqual(1)
    }

    expect(THEME_PART_GUIDES['conversation.message'].filename).toBe('conversation.webp')
    expect(THEME_PART_GUIDES['conversation.message-content'].filename).toBe('conversation.webp')
    expect(THEME_PART_GUIDES['tool.card'].filename).toBe('conversation.webp')
    expect(THEME_PART_GUIDES['shell.details'].filename).toBe('details.webp')
    expect(THEME_PART_GUIDES['primitive.tooltip'].filename).toBe('tooltip.webp')
  })
})

describe('guide asset route', () => {
  async function service(): Promise<Parameters<SkinWebServer['register']>[0]['handler']> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skin-guides-'))
    roots.push(root)
    const library = await SkinLibrary.open(join(root, 'skins'))
    let handler: Parameters<SkinWebServer['register']>[0]['handler'] | undefined
    registerSkinHttp({
      register: route => { handler = route.handler; return () => {} },
      tapIndex: () => () => {},
    }, library, guidesRoot)
    if (handler === undefined) throw new Error('skin handler was not registered')
    return handler
  }

  async function request(pathname: string, remoteAddress = '127.0.0.1', method = 'GET'): Promise<{ status: number; headers: Record<string, string | number>; body: Buffer }> {
    const handler = await service()
    const incoming = Readable.from([])
    Object.assign(incoming, { method, url: pathname, headers: {} })
    Object.defineProperty(incoming, 'socket', { value: { remoteAddress } })
    let status = 0
    let headers: Record<string, string | number> = {}
    const chunks: Buffer[] = []
    const response = {
      headersSent: false,
      writeHead(code: number, nextHeaders: Record<string, string | number>) {
        status = code
        headers = nextHeaders
        this.headersSent = true
        return this
      },
      end(chunk?: Uint8Array) {
        if (chunk !== undefined) chunks.push(Buffer.from(chunk))
      },
      write() { return true },
    }
    await handler(incoming as IncomingMessage, response as unknown as ServerResponse)
    return { status, headers, body: Buffer.concat(chunks) }
  }

  it('serves only allowlisted WebP files with immutable safe headers', async () => {
    const response = await request('/api/dsh-skin/guides/shell.webp')
    expect(response.status).toBe(200)
    expect(response.headers).toMatchObject({
      'Content-Type': 'image/webp',
      'Content-Length': response.body.byteLength,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(response.body.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(response.body.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(response.body).toEqual(await readFile(join(guidesRoot, 'shell.webp')))
  })

  it.each(['conversation.webp', 'details.webp', 'tooltip.webp'])('serves the additional real DSH guide: %s', async (filename) => {
    const response = await request(`/api/dsh-skin/guides/${filename}`)
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toBe('image/webp')
    expect(response.body.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(response.body.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(response.body).toEqual(await readFile(join(guidesRoot, filename)))
  })

  it.each([
    '/api/dsh-skin/guides/unknown.webp',
    '/api/dsh-skin/guides/%2e%2e%2fshell.webp',
    '/api/dsh-skin/guides/%2e%2e/shell.webp',
    '/api/dsh-skin/guides/dialog.png',
  ])('returns 404 without reading an unapproved path: %s', async (pathname) => {
    const response = await request(pathname)
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ ok: false, error: 'Skin endpoint not found' })
  })

  it('does not expose the removed executable experience route', async () => {
    const response = await request(`/api/dsh-skin/experience/${'a'.repeat(64)}/client.js`)
    expect(response.status).toBe(404)
  })

  it.each([
    '/api/dsh-skin/guides/unknown.webp',
    '/api/dsh-skin/guides/%2e%2e%2fshell.webp',
    '/api/dsh-skin/guides/%2e%2e/shell.webp',
  ])('keeps unknown guide paths at 404 before loopback mutation authorization: %s', async (pathname) => {
    const response = await request(pathname, '203.0.113.10')
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ ok: false, error: 'Skin endpoint not found' })
  })

  it('rejects writes to the read-only guide namespace before mutation authorization', async () => {
    const response = await request('/api/dsh-skin/guides/shell.webp', '203.0.113.10', 'POST')
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ ok: false, error: 'Skin endpoint not found' })
  })

  it.each(
    ['127.0.0.1', '203.0.113.10'].flatMap(remoteAddress =>
      ['../', '%2e%2e/'].flatMap(segment => [
        [`/api/dsh-skin/guides/${segment}state`, remoteAddress],
        [`/api/dsh-skin/guides/${segment}events`, remoteAddress],
        [`/api/dsh-skin/guides/${segment}skins/${'a'.repeat(64)}`, remoteAddress],
        [`/api/dsh-skin/guides/${segment}assets/${'a'.repeat(64)}/x.png`, remoteAddress],
      ]),
    ),
  )('does not let a raw guide path escape into another endpoint: %s from %s', async (pathname, remoteAddress) => {
    const response = await request(pathname, remoteAddress)
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ ok: false, error: 'Skin endpoint not found' })
  })

  it.each(
    ['127.0.0.1', '203.0.113.10'].flatMap(remoteAddress => [
      ['/api/dsh-skin/guides\\..\\state', remoteAddress],
      ['/api/dsh-skin/guides\\..\\events', remoteAddress],
      [`/api/dsh-skin/guides\\..\\skins\\${'a'.repeat(64)}`, remoteAddress],
      [`/api/dsh-skin/guides\\..\\assets\\${'a'.repeat(64)}\\x.png`, remoteAddress],
    ]),
  )('rejects backslashes before URL normalization can escape the guide namespace: %s from %s', async (pathname, remoteAddress) => {
    const response = await request(pathname, remoteAddress)
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ ok: false, error: 'Skin endpoint not found' })
  })

  it.each(
    ['127.0.0.1', '203.0.113.10'].flatMap(remoteAddress =>
      ['/api\\dsh-skin\\guides\\..\\', '\\api\\dsh-skin\\guides\\..\\'].flatMap(prefix => [
        [`${prefix}state`, remoteAddress],
        [`${prefix}events`, remoteAddress],
        [`${prefix}skins\\${'a'.repeat(64)}`, remoteAddress],
        [`${prefix}assets\\${'a'.repeat(64)}\\x.png`, remoteAddress],
      ]),
    ),
  )('rejects mixed-prefix backslashes before URL normalization: %s from %s', async (pathname, remoteAddress) => {
    const response = await request(pathname, remoteAddress)
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ ok: false, error: 'Skin endpoint not found' })
  })
})
