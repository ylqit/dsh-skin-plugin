// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkinExperienceRuntime } from '../src/client/experience-runtime.ts'
import type { SkinExperienceDescriptor } from '../src/shared/contracts.ts'

function descriptor(moduleId: string, rev: string): SkinExperienceDescriptor {
  return {
    apiVersion: 1,
    moduleId,
    url: `/api/dsh-skin/experience/${rev}/client.js`,
    rev,
    placements: ['skin.shell.floating'],
    assets: {},
  }
}

afterEach(() => {
  for (const style of document.querySelectorAll('style[data-plugin]')) style.remove()
})

describe('SkinExperienceRuntime', () => {
  it('loads only declared placement components and owns module/style cleanup', async () => {
    const modules = new Map<string, unknown>()
    const invalidate = vi.fn((id: string) => { modules.delete(id) })
    const loader = vi.fn(async (skin: SkinExperienceDescriptor) => {
      const Floating = (): null => null
      modules.set(skin.moduleId, { apiVersion: 1, components: { 'skin.shell.floating': Floating } })
      const style = document.createElement('style')
      style.dataset.plugin = skin.moduleId
      document.head.append(style)
    })
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async id => modules.get(id),
      invalidate,
    }, loader)

    await runtime.install(descriptor('skin-a', 'a'.repeat(64)), 'theme-a')
    expect(runtime.getSnapshot()?.themeId).toBe('theme-a')
    expect(runtime.getSnapshot()?.components['skin.shell.floating']).toEqual(expect.any(Function))
    expect(document.querySelector('style[data-plugin="skin-a"]')).not.toBeNull()

    runtime.clear()
    expect(runtime.getSnapshot()).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith('skin-a')
    expect(document.querySelector('style[data-plugin="skin-a"]')).toBeNull()
  })

  it('rejects undeclared component placements', async () => {
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async () => ({
        apiVersion: 1,
        components: { 'skin.shell.top': (): null => null },
      }),
      invalidate: vi.fn(),
    }, async () => {})

    await expect(runtime.install(descriptor('invalid-skin', 'c'.repeat(64)), 'invalid')).rejects.toThrow(/未声明|undeclared/u)
    expect(runtime.getSnapshot()).toBeUndefined()
  })

  it('ignores an older bundle that finishes after a newer skin', async () => {
    const modules = new Map<string, unknown>()
    const pending = new Map<string, () => void>()
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async id => modules.get(id),
      invalidate: id => { modules.delete(id) },
    }, skin => new Promise<void>(resolve => {
      pending.set(skin.moduleId, () => {
        modules.set(skin.moduleId, {
          apiVersion: 1,
          components: { 'skin.shell.floating': (): null => null },
        })
        resolve()
      })
    }))

    const oldInstall = runtime.install(descriptor('old-skin', 'd'.repeat(64)), 'old')
    const newInstall = runtime.install(descriptor('new-skin', 'e'.repeat(64)), 'new')
    pending.get('new-skin')?.()
    await newInstall
    pending.get('old-skin')?.()
    await oldInstall

    expect(runtime.getSnapshot()?.themeId).toBe('new')
    expect(modules.has('old-skin')).toBe(false)
  })

  it('loads the immutable same-origin Experience endpoint with its revision', async () => {
    let scriptUrl = ''
    vi.spyOn(document.head, 'append').mockImplementation((...nodes: (Node | string)[]) => {
      const script = nodes[0] as HTMLScriptElement
      scriptUrl = script.src
      queueMicrotask(() => { script.dispatchEvent(new Event('load')) })
    })
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async () => ({
        apiVersion: 1,
        components: { 'skin.shell.floating': (): null => null },
      }),
      invalidate: vi.fn(),
    })
    const skin = descriptor('managed-skin', 'f'.repeat(64))
    await runtime.install(skin, 'managed')
    expect(scriptUrl).toContain(`/api/dsh-skin/experience/${'f'.repeat(64)}/client.js?rev=${'f'.repeat(64)}`)
  })
})
