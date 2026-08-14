/** Browser half: active-skin synchronization and the Settings theme studio. */

import { SkinStudio } from './SkinStudio.tsx'
import { SkinStudioController } from './controller.ts'
import type { ClientContext, SkinStudioInjected } from './contracts.ts'

export const inject = ['slots', 'theme', 'connection']

/** Mount one controller and contribute its pure component into Settings. */
export function apply(rawContext: unknown): void {
  const ctx = rawContext as ClientContext
  if (
    typeof ctx.theme?.installSkin !== 'function'
    || typeof ctx.theme.exportInspectTokens !== 'function'
    || typeof ctx.theme.exportInspectParts !== 'function'
  ) {
    throw new Error('dsh-skin-plugin requires a Harness build with synchronized component-skin APIs (themePartsVersion 1)')
  }
  const controller = new SkinStudioController(ctx.theme, ctx.connection.isLoopback)
  ctx.effect(() => controller.start(), 'dsh-skin-plugin: active skin synchronization')
  const injected = (): SkinStudioInjected => ({
    hooks: { studio: controller },
    beginDraft: fingerprint => { controller.beginDraft(fingerprint) },
    updateDraftName: name => { controller.updateDraftName(name) },
    updateToken: (name, mode, value) => { controller.updateToken(name, mode, value) },
    updateBackdrop: (mode, field, value) => { controller.updateBackdrop(mode, field, value) },
    updateBackdropImage: file => { controller.updateBackdropImage(file) },
    upsertPartRule: (part, variant, state, field, light, dark) => { controller.upsertPartRule(part, variant, state, field, light, dark) },
    importSkin: file => { controller.importSkin(file) },
    saveDraft: () => { controller.saveDraft() },
    exportDraft: () => { controller.exportDraft() },
    activate: fingerprint => { controller.activate(fingerprint) },
    restoreDefault: () => { controller.restoreDefault() },
    cancelPreview: () => { controller.cancelPreview() },
    setColorScheme: mode => { controller.setColorScheme(mode) },
    deleteSkin: fingerprint => { controller.deleteSkin(fingerprint) },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skins',
    order: 12,
    label: '外观主题',
    inject: injected,
  }, SkinStudio))
}
