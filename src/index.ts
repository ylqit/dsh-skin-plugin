/** Host half: immutable library, local management API, and first-paint provider. */

import type { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { createSkinBootInjector } from './host/boot.ts'
import { registerSkinHttp, type SkinWebServer } from './host/http.ts'
import { SkinLibrary } from './host/library.ts'

export type {
  SkinManifestV3, SkinRuntimeCompatibility, ThemeLayerV2,
  ThemePartId, ThemePartRule, ThemePartState, ThemePartStyle, ThemePartVariant,
} from './shared/contracts.ts'

const BUILTINS_ROOT = fileURLToPath(new URL('../builtins', import.meta.url))

type DshHomePath = (...segments: string[]) => string

/** Host services required before the library can expose any skin. */
export const inject = ['dshHomePath', 'webServer']

/** Mount the Host library and bind every effect to this Loader fiber. */
export async function apply(ctx: Context): Promise<void> {
  const dshHomePath = ctx.get('dshHomePath') as DshHomePath | undefined
  const webServer = ctx.get('webServer') as SkinWebServer | undefined
  if (dshHomePath === undefined || webServer === undefined) {
    throw new Error('dsh-skin-plugin 0.3.0 requires DSH 0.1.0-rc.5 Host services (dshHomePath and webServer)')
  }
  const library = await SkinLibrary.open(
    dshHomePath('skins-v3'),
    (error) => { ctx.logger.warn(error) },
    BUILTINS_ROOT,
  )
  const injectSkinBoot = createSkinBootInjector(() => library.activeBoot())
  const untapIndex = webServer.tapIndex(injectSkinBoot)
  const unregisterHttp = registerSkinHttp(webServer, library)
  ctx.effect(() => () => {
    unregisterHttp()
    untapIndex()
  }, 'dsh-skin-plugin: host routes and first-paint provider')
}
