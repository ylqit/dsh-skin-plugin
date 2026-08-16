// @vitest-environment jsdom
import { createElement, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkinExperienceHost } from '../src/client/SkinExperienceHost.tsx'
import { SkinExperienceRuntime } from '../src/client/experience-runtime.ts'
import type { SkinExperienceDescriptor } from '../src/shared/contracts.ts'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('SkinExperienceHost', () => {
  it('portals owned decorations into current Part anchors and removes every mount on clear', async () => {
    const SidebarBrand = (): ReturnType<typeof createElement> => createElement('strong', null, 'leaf brand')
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async () => ({
        apiVersion: 1,
        components: { 'skin.sidebar.brand': SidebarBrand },
      }),
      invalidate: vi.fn(),
    }, async () => {})
    const descriptor: SkinExperienceDescriptor = {
      apiVersion: 1,
      moduleId: 'brand-skin',
      url: `/api/dsh-skin/experience/${'a'.repeat(64)}.js`,
      rev: 'a'.repeat(64),
      placements: ['skin.sidebar.brand'],
      assets: {},
    }
    const sidebar = document.createElement('aside')
    sidebar.dataset.dshThemePart = 'shell.sidebar'
    const rootNode = document.createElement('div')
    document.body.append(sidebar, rootNode)
    const root = createRoot(rootNode)
    const useExperience = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))

    await act(async () => {
      root.render(createElement(SkinExperienceHost, { useExperience }))
      await runtime.install(descriptor, 'bulbasaur')
    })
    expect(sidebar.querySelector('[data-dsh-skin-experience-mount="skin.sidebar.brand"]')?.textContent).toBe('leaf brand')

    await act(async () => { runtime.clear() })
    expect(document.querySelector('[data-dsh-skin-experience-mount]')).toBeNull()
    await act(async () => { root.unmount() })
  })
})
