import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'

const roots: string[] = []
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

it('uses the Host parser before writing a packed skin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skin-cli-'))
  roots.push(root)
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'assets', 'preview.png'), PNG)
  await writeFile(join(root, 'skin.config.json'), JSON.stringify({
    id: 'invalid-theme',
    name: 'Invalid Theme',
    version: '2.0.0',
    preview: { light: 'assets/preview.png', dark: 'assets/preview.png' },
  }))
  await writeFile(join(root, 'theme.json'), JSON.stringify({
    schemaVersion: 2,
    tokens: { '--private-token': { light: '#ffffff', dark: '#000000' } },
  }))
  const output = join(root, 'invalid.dshskin')

  await expect(runCli(['pack', root, output])).rejects.toThrow(/not registered/)
  await expect(import('node:fs/promises').then(fs => fs.stat(output))).rejects.toMatchObject({ code: 'ENOENT' })
})
