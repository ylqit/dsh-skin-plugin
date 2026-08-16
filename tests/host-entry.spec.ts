import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import type { SkinWebServer } from '../src/host/http.ts'

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

it('opens only the schema-v4 storage namespace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-skin-home-'))
  roots.push(home)
  const requested: string[][] = []
  const webServer: SkinWebServer = {
    register: () => () => {},
    tapIndex: () => () => {},
  }
  const context = {
    get(name: string) {
      if (name === 'dshHomePath') {
        return (...segments: string[]) => {
          requested.push(segments)
          return join(home, ...segments)
        }
      }
      if (name === 'webServer') return webServer
      return undefined
    },
    logger: { warn: vi.fn() },
    effect: vi.fn(),
  }

  await apply(context as never)

  expect(requested).toEqual([['skins-v4']])
})
