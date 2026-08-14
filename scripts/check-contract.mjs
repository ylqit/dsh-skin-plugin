/**
 * Contract gate: the plugin must not depend on the unreleased Harness theme
 * contract at runtime. Fails when any source or build artifact references
 * `@deepseek-ai/dsh-client-ui-theme`, then smoke-imports the built host entry
 * so missing/stale exports fail `pnpm check` instead of a user's boot.
 */

import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FORBIDDEN = '@deepseek-ai/dsh-client-ui-theme'
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
    if (content.includes(FORBIDDEN)) violations.push(file)
  }
}
if (violations.length > 0) {
  console.error(`contract gate: forbidden reference ${FORBIDDEN} found in:`)
  for (const file of violations) console.error(`  ${relative(process.cwd(), file)}`)
  process.exit(1)
}

const entry = resolve(ROOT, 'lib', 'index.js')
await import(pathToFileURL(entry).href)
console.log('contract gate: no theme-package references; lib/index.js imports cleanly')
