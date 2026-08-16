/** Browser half: overlay presentation, active-skin synchronization, and the Settings theme studio. */

import { SkinStudio } from './SkinStudio.tsx'
import { SkinExperienceHost } from './SkinExperienceHost.tsx'
import { SkinStudioController } from './controller.ts'
import type { ClientContext, SkinStudioInjected } from './contracts.ts'
import { SkinExperienceRuntime } from './experience-runtime.ts'
import { startPartStamper } from './part-stamper.ts'

export const inject = ['slots', 'theme', 'connection', 'modules']

/** Mount one controller and contribute its pure component into Settings. */
export function apply(rawContext: unknown): void {
  const ctx = rawContext as ClientContext
  if (
    typeof ctx.theme?.getTheme !== 'function'
    || typeof ctx.slots?.inject !== 'function'
    || ctx.modules?.version !== 'client'
    || typeof ctx.modules.import !== 'function'
    || typeof ctx.modules.invalidate !== 'function'
  ) {
    throw new Error('dsh-skin-plugin 0.3.0 requires the current DSH web client (theme, slots and modules services)')
  }
  const experience = new SkinExperienceRuntime(ctx.modules)
  const controller = new SkinStudioController(ctx.theme, ctx.connection.isLoopback, experience)
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
    setPartEnabled: (part, enabled) => { controller.setPartEnabled(part, enabled) },
    resetPartProperty: (part, variant, state, field) => { controller.resetPartProperty(part, variant, state, field) },
    updatePartSurfaceImage: (part, variant, state, mode, file) => { controller.updatePartSurfaceImage(part, variant, state, mode, file) },
    undo: () => { controller.undo() },
    redo: () => { controller.redo() },
    importSkin: file => { controller.importSkin(file) },
    saveDraft: () => { controller.saveDraft() },
    exportDraft: () => { controller.exportDraft() },
    activate: fingerprint => { controller.activate(fingerprint) },
    restoreDefault: () => { controller.restoreDefault() },
    resumePreview: () => { controller.resumePreview() },
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
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'dsh-skin-experience',
      order: 90,
      inject: () => ({ hooks: { experience } }),
    }, SkinExperienceHost)), 'dsh-skin-plugin: skin experience decorations')
}
