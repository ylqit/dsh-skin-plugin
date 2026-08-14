import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'tsdown'
import { clientCssModules } from '../../build/css-modules.ts'

const EXPERIENCE_LIMIT = 2 * 1024 * 1024
const PLATFORM_IMPORTS = new Set(['react', 'react/jsx-runtime'])

/** Compile one author TSX entry into Harness's managed CommonJS handoff format. */
export async function compileExperience(root: string, moduleId: string): Promise<Uint8Array> {
  const entry = resolve(root, 'experience', 'client.tsx')
  await readFile(entry)
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-skin-build-'))
  try {
    await build({
      config: false,
      cwd: root,
      entry: { client: entry },
      outDir: temporary,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      tsconfig: false,
      clean: true,
      dts: false,
      sourcemap: false,
      deps: {
        neverBundle: [...PLATFORM_IMPORTS],
        alwaysBundle: id => !PLATFORM_IMPORTS.has(id),
        onlyBundle: false,
      },
      plugins: [clientCssModules(moduleId)],
      outputOptions: {
        entryFileNames: 'client.js',
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(moduleId)}, factory: (require) => {`,
        footer: 'return module.exports; } });',
        intro: 'var module = { exports: {} }; var exports = module.exports;',
      },
    })
    const bytes = new Uint8Array(await readFile(join(temporary, 'client.js')))
    if (bytes.byteLength === 0 || bytes.byteLength > EXPERIENCE_LIMIT) {
      throw new TypeError(`Experience Bundle 必须小于 ${String(EXPERIENCE_LIMIT)} 字节`)
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!source.includes('window.__ModuleLoader__.load') || !source.includes(JSON.stringify(moduleId))) {
      throw new TypeError('Experience Bundle 未生成正确的 Harness 模块交接代码')
    }
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/gu)) {
      const specifier = match[1] as string
      if (!PLATFORM_IMPORTS.has(specifier)) {
        throw new TypeError(`Experience Bundle 含不受支持的运行时依赖 ${JSON.stringify(specifier)}`)
      }
    }
    return bytes
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
