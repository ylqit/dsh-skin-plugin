/**
 * Contract gate for the v4 declarative/current-DSH release line. It rejects removed
 * protocol type names and the retired storage namespace, then smoke-imports
 * the built host entry so missing/stale exports fail before publication.
 * It also rejects a browser bundle that hoists a require of any Node
 * builtin (e.g. fflate's node export condition pulling `module`): the dsh
 * client module table can only resolve platform seeds and client entries.
 */

import { builtinModules } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FORBIDDEN = [
  'ThemeLayerDefinition',
  'SkinManifestV1',
  'SkinManifestV2',
  'SkinManifestV3',
  'SkinExperience',
  'component-experience',
  'experience/client',
  'dsh-client-modules',
  "dshHomePath('skins-v3')",
  "dshHomePath('skins')",
]
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml'])
const SKIP_DIRECTORIES = new Set(['node_modules', 'reference', '.git', 'build'])

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      yield* walk(join(directory, entry.name))
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      yield join(directory, entry.name)
    }
  }
}

const violations = []
for (const base of ['src', 'lib']) {
  for await (const file of walk(resolve(ROOT, base))) {
    const content = await readFile(file, 'utf8')
    for (const token of FORBIDDEN) {
      if (content.includes(token)) violations.push({ file, token })
    }
  }
}
if (violations.length > 0) {
  console.error('contract gate: removed protocol/storage references found in:')
  for (const violation of violations) console.error(`  ${relative(process.cwd(), violation.file)}: ${violation.token}`)
  process.exit(1)
}

const clientBundle = await readFile(resolve(ROOT, 'lib', 'client.js'), 'utf8')
const builtins = new Set(builtinModules)
const nodeRequires = [...clientBundle.matchAll(/require\("([^"]+)"\)/g)]
  .map(match => match[1])
  .filter(id => builtins.has(id) || id.startsWith('node:'))
if (nodeRequires.length > 0) {
  console.error(`contract gate: lib/client.js requires Node builtins ${[...new Set(nodeRequires)].join(', ')} — the dsh client module table cannot resolve them`)
  process.exit(1)
}

const entry = resolve(ROOT, 'lib', 'index.js')
await import(pathToFileURL(entry).href)
console.log('contract gate: v4 declarative/current-DSH surface clean; no Node builtins in client bundle; lib/index.js imports cleanly')
