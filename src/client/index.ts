/** Browser half: active-skin synchronization and the Settings theme studio. */

import { SkinStudio } from './SkinStudio.tsx'
import { SkinPlacementHost } from './SkinPlacementHost.tsx'
import { SkinStudioController } from './controller.ts'
import type { ClientContext, SkinStudioInjected } from './contracts.ts'
import { SKIN_PLACEMENTS } from '../shared/contracts.ts'

export const inject = ['slots', 'theme', 'connection', 'modules']

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
  if (typeof ctx.modules?.loadDynamic !== 'function') {
    throw new Error('dsh-skin-plugin requires a Harness build with managed dynamic client modules')
  }
  const controller = new SkinStudioController(ctx.theme, ctx.modules, ctx.connection.isLoopback)
  ctx.effect(() => controller.start(), 'dsh-skin-plugin: active skin synchronization')
  ctx.effect(() => ctx.on('theme/change', snapshot => {
    controller.setResolvedMode(snapshot.active.colorScheme)
  }), 'dsh-skin-plugin: experience color mode')
  const injected = (): SkinStudioInjected => ({
    hooks: { studio: controller },
    beginDraft: fingerprint => { controller.beginDraft(fingerprint) },
    updateDraftName: name => { controller.updateDraftName(name) },
    updateToken: (name, mode, value) => { controller.updateToken(name, mode, value) },
    updateBackdrop: (mode, field, value) => { controller.updateBackdrop(mode, field, value) },
    updateBackdropImage: (mode, file) => { controller.updateBackdropImage(mode, file) },
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
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'skins',
      order: 12,
      label: '外观主题',
      inject: injected,
    }, SkinStudio)), 'dsh-skin-plugin: appearance studio')

  for (const placement of SKIN_PLACEMENTS) {
    ctx.effect(() => ctx.slots.inject(placement, () => ctx.slots.register({
        name: placement,
        id: '@deepseek-ai/dsh-skin-plugin',
        inject: () => ({
          placement,
          hooks: { experience: controller.experience },
        }),
      }, SkinPlacementHost)), `dsh-skin-plugin: ${placement}`)
  }
}
