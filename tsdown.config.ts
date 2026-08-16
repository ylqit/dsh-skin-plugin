import type { UserConfig } from 'tsdown'
import { clientCssModules } from './build/css-modules.ts'

const ID = '@ylq77147/dsh-skin-plugin'
const PLATFORM = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

const host: UserConfig = {
  entry: { index: 'src/index.ts', invariant: 'src/invariant.ts', cli: 'src/cli.ts' },
  outDir: 'lib',
  format: ['esm'],
  fixedExtension: false,
  platform: 'node',
  target: 'es2024',
  dts: true,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis', '@deepseek-ai/dsh-invariants',
      'lightningcss', 'tsdown',
    ],
  },
}

const client: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // Force the browser-safe fflate entry: its node export condition ships a
  // createRequire worker shim that hoists require("module") into the bundle,
  // which the dsh client module table cannot resolve at runtime.
  alias: { fflate: 'fflate/browser' },
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: PLATFORM,
    alwaysBundle: (id: string) => !PLATFORM.includes(id),
    onlyBundle: false,
  },
  plugins: [clientCssModules(ID)],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [host, client]
