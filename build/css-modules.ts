import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import type { TsdownPlugin } from 'tsdown'

const CSS_PREFIX = '\0dsh-skin-css:'
const CSS_SUFFIX = '.mjs'

/** Compile CSS Modules into module-owned style tags understood by Harness cleanup. */
export function clientCssModules(moduleId: string): TsdownPlugin {
  return {
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
        `const id = ${JSON.stringify(`${moduleId}/${basename(filename)}`)};`,
        `const css = ${JSON.stringify(result.code.toString())};`,
        "if (document.querySelector('style[data-plugin-css=' + JSON.stringify(id) + ']') === null) {",
        "  const node = document.createElement('style');",
        `  node.dataset.plugin = ${JSON.stringify(moduleId)};`,
        '  node.dataset.pluginCss = id;',
        '  node.textContent = css;',
        '  document.head.append(node);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}
