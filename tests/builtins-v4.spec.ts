import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseSkinArchive } from '../src/host/archive.ts'

const BUILTINS = ['squirtle-water', 'bulbasaur-growth', 'pikachu-energy'] as const

describe('0.4.0 declarative built-in themes', () => {
  it('ships three public-parser v4 archives without executable or fixed-placement content', async () => {
    for (const id of BUILTINS) {
      const bytes = new Uint8Array(await readFile(join(process.cwd(), 'builtins', `${id}.dshskin`)))
      const entries = unzipSync(bytes)
      const parsed = parseSkinArchive(bytes)
      expect(parsed.manifest).toMatchObject({ schemaVersion: 4, id, version: '3.0.0' })
      expect(parsed.manifest.capabilities).toContain('component-visuals')
      expect(parsed.visuals?.items.length).toBeGreaterThan(0)
      expect(Object.keys(entries).some(path => /experience|client\.js|\.css$/iu.test(path))).toBe(false)
      expect(new TextDecoder().decode(entries['manifest.json'])).not.toMatch(/placement|experience/iu)
    }
  })

  it('uses one shared glass layout signature for all themes', async () => {
    const layers = await Promise.all(BUILTINS.map(async id => parseSkinArchive(
      new Uint8Array(await readFile(join(process.cwd(), 'builtins', `${id}.dshskin`))),
    ).layer))
    const signatures = layers.map(layer => layer.partStyles?.map(rule => `${rule.part}:${rule.variant ?? ''}:${rule.state ?? ''}`))
    expect(signatures[1]).toEqual(signatures[0])
    expect(signatures[2]).toEqual(signatures[0])
    for (const layer of layers) {
      const parts = new Map(layer.partStyles?.map(rule => [rule.part, rule]))
      expect(parts.get('conversation.root')?.style.light.background).toBe('transparent')
      expect(parts.get('shell.main')?.style.light.background).toBe('transparent')
      expect(parts.get('conversation.composer')?.style.light.backdropBlurPx).toBeGreaterThanOrEqual(16)
      // backdrop-filter makes the sidebar a containing block and traps DSH's
      // fixed settings overlay inside the rail. Keep its glass color/shadow,
      // but reserve blur for surfaces that do not own global portals.
      expect(parts.get('shell.sidebar')?.style.light.backdropBlurPx).toBeUndefined()
      expect(parts.get('primitive.dialog-surface')?.style.light.backdropBlurPx).toBeGreaterThanOrEqual(16)
    }
  })
})
