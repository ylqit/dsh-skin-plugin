/** Browser half: overlay presentation, active-skin synchronization, and the Settings theme studio. */

import { SkinStudio } from './SkinStudio.tsx'
import { SkinStudioController } from './controller.ts'
import type { ClientContext, SkinStudioInjected } from './contracts.ts'
import { startPartStamper } from './part-stamper.ts'

export const inject = ['slots', 'theme', 'connection']

/** Mount one controller and contribute its pure component into Settings. */
export function apply(rawContext: unknown): void {
  const ctx = rawContext as ClientContext
  if (typeof ctx.theme?.getTheme !== 'function' || typeof ctx.slots?.inject !== 'function') {
    throw new Error('dsh-skin-plugin requires the official dsh web client (theme and slots services)')
  }
  const controller = new SkinStudioController(ctx.theme, ctx.connection.isLoopback)
  ctx.effect(() => controller.start(), 'dsh-skin-plugin: active skin synchronization')
  ctx.effect(() => startPartStamper(), 'dsh-skin-plugin: part anchor shim')
  ctx.effect(() => ctx.on('theme/change', snapshot => {
    controller.setResolvedMode(snapshot.active.colorScheme)
  }), 'dsh-skin-plugin: color mode tracking')
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
}
