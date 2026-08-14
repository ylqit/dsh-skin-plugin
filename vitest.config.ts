import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const candidates = [
  process.env.DSH_HARNESS_ROOT,
  resolve(process.cwd(), 'reference/deepseek-harness'),
  resolve(process.cwd(), '../../deepseek-harness/.worktrees/synchronized-skins'),
].filter((candidate): candidate is string => candidate !== undefined)
const harnessRoot = candidates.find(candidate => existsSync(resolve(candidate, 'packages/client/ui-theme/src/theme-layer.ts')))

export default defineConfig({
  ...(harnessRoot === undefined
    ? {}
    : { resolve: {
        alias: [{
          find: /^@deepseek-ai\/dsh-client-ui-theme$/,
          replacement: resolve(harnessRoot, 'packages/client/ui-theme/src/theme-layer.ts'),
        }],
      } }),
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
