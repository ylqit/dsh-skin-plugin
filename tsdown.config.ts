import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const ID = '@deepseek-ai/dsh-skin-plugin'
const PLATFORM = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]
const CSS_PREFIX = '\0dsh-skin-css:'
const CSS_SUFFIX = '.mjs'

const host: UserConfig = {
  entry: { index: 'src/index.ts', invariant: 'src/invariant.ts' },
  outDir: 'lib',
  format: ['esm'],
  fixedExtension: false,
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-invariants'],
  },
}

const client: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: PLATFORM,
    alwaysBundle: (id: string) => !PLATFORM.includes(id),
    onlyBundle: false,
  },
  plugins: [{
    name: 'dsh-skin-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return `${CSS_PREFIX}${resolve(dirname(importer), source)}${CSS_SUFFIX}`
    },
    async load(id: string) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const filename = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      this.addWatchFile(filename)
      const result = transform({
        filename,
        code: await readFile(filename),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, value]) => [key, value.name]))
      return [
        `const id = ${JSON.stringify(`${ID}/${basename(filename)}`)};`,
        `const css = ${JSON.stringify(result.code.toString())};`,
        "if (document.querySelector('style[data-plugin-css=' + JSON.stringify(id) + ']') === null) {",
        "  const node = document.createElement('style');",
        `  node.dataset.plugin = ${JSON.stringify(ID)};`,
        '  node.dataset.pluginCss = id;',
        '  node.textContent = css;',
        '  document.head.append(node);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [host, client]
