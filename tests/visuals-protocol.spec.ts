import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSkinArchive } from '../src/host/archive.ts'
import { SkinLibrary } from '../src/host/library.ts'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

function archive(options: {
  schemaVersion?: number
  visuals?: unknown
  extra?: Zippable
} = {}): Uint8Array {
  const visuals = options.visuals ?? {
    schemaVersion: 1,
    items: [{
      id: 'sidebar-partner',
      slot: 'sidebar.brand-mark',
      template: 'compact-brand',
      label: '搭档',
      modes: {
        light: { assetUrl: 'asset:assets/mark.png', foreground: '#123456', background: '#ffffffcc', fit: 'contain', positionX: 0.4, positionY: 0.6 },
        dark: { assetUrl: 'asset:assets/mark.png', foreground: '#dbeafe', background: '#10243dcc', fit: 'cover', positionX: 0.55, positionY: 0.45 },
      },
    }],
  }
  const files: Zippable = {
    'manifest.json': strToU8(JSON.stringify({
      schemaVersion: options.schemaVersion ?? 4,
      id: 'visual-skin', name: 'Visual Skin', version: '3.0.0', tags: [],
      themePartsVersion: 2,
      capabilities: ['tokens', 'component-visuals'],
      assets: [{
        path: 'assets/mark.png', mimeType: 'image/png',
        sha256: createHash('sha256').update(PNG).digest('hex'), bytes: PNG.byteLength,
        purpose: 'visual',
      }],
      visuals: { schemaVersion: 1, entry: 'visuals.json' },
    })),
    'theme.json': strToU8(JSON.stringify({
      schemaVersion: 2,
      tokens: { '--dsw-alias-bg-base': { light: '#f4f7fb', dark: '#0b1020' } },
    })),
    'visuals.json': strToU8(JSON.stringify(visuals)),
    'assets/mark.png': PNG,
    ...(options.extra ?? {}),
  }
  return zipSync(files, { level: 9 })
}

describe('schema v4 declarative visuals', () => {
  it('parses one allowlisted visual and rewrites its image to a same-origin asset URL', () => {
    const parsed = parseSkinArchive(archive())
    expect(parsed.manifest.schemaVersion).toBe(4)
    expect(parsed.visuals).toMatchObject({
      schemaVersion: 1,
      items: [{ id: 'sidebar-partner', slot: 'sidebar.brand-mark', template: 'compact-brand' }],
    })
    expect(parsed.visuals?.items[0]?.modes.light.assetUrl)
      .toMatch(/^\/api\/dsh-skin\/assets\/[a-f0-9]{64}\/mark\.png$/)
    expect(parsed.visuals?.items[0]?.modes.light).toMatchObject({ fit: 'contain', positionX: 0.4, positionY: 0.6 })
  })

  it.each([
    [{ fit: 'stretch' }, /fit/],
    [{ positionX: 2 }, /positionX/],
    [{ positionY: -1 }, /positionY/],
  ])('rejects invalid visual image presentation %j', (mode, message) => {
    const visuals = {
      schemaVersion: 1,
      items: [{
        id: 'bad-mode', slot: 'sidebar.brand-mark', template: 'image-mark',
        modes: { light: { assetUrl: 'asset:assets/mark.png', ...mode }, dark: { assetUrl: 'asset:assets/mark.png' } },
      }],
    }
    expect(() => parseSkinArchive(archive({ visuals }))).toThrow(message)
  })

  it.each([1, 2, 3])('rejects schema v%s as an unsupported protocol', (schemaVersion) => {
    expect(() => parseSkinArchive(archive({ schemaVersion }))).toThrow(expect.objectContaining({
      code: 'UNSUPPORTED_PROTOCOL', field: 'manifest.json.schemaVersion',
    }))
  })

  it('rejects unknown slots, templates and external visual assets', () => {
    for (const visuals of [
      { schemaVersion: 1, items: [{ id: 'bad-slot', slot: 'skin.shell.floating', template: 'image-mark', modes: { light: { assetUrl: 'asset:assets/mark.png' }, dark: { assetUrl: 'asset:assets/mark.png' } } }] },
      { schemaVersion: 1, items: [{ id: 'bad-template', slot: 'sidebar.brand-mark', template: 'custom-react', modes: { light: {}, dark: {} } }] },
      { schemaVersion: 1, items: [{ id: 'external-image', slot: 'sidebar.brand-mark', template: 'image-mark', modes: { light: { assetUrl: 'https://example.com/mark.png' }, dark: { assetUrl: 'https://example.com/mark.png' } } }] },
    ]) expect(() => parseSkinArchive(archive({ visuals }))).toThrow()
  })

  it('rejects executable experience bundles as unsupported archive content', () => {
    expect(() => parseSkinArchive(archive({
      extra: { 'experience/client.js': strToU8('export default function unsafe() {}') },
    }))).toThrow(/unsupported entry.*experience\/client\.js/)
  })

  it('persists only v4 state and carries visuals through prepare and commit', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skin-v4-'))
    roots.push(home)
    const root = join(home, 'skins-v4')
    const library = await SkinLibrary.open(root)
    const imported = await library.import(archive())
    const prepared = library.prepare(imported.fingerprint)
    expect(prepared.visuals?.items[0]?.slot).toBe('sidebar.brand-mark')
    await library.commit(prepared.preparationId)
    expect(library.snapshot().activeVisuals?.items[0]?.template).toBe('compact-brand')
    expect(await readFile(join(root, 'state-v4.json'), 'utf8')).toContain(imported.fingerprint)
    expect(await readdir(root)).not.toContain('state-v3.json')
  })
})
