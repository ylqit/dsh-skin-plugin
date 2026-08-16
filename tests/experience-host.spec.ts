// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
    const sidebarColumn = document.createElement('aside')
    const sidebarSlot = document.createElement('div')
    sidebarSlot.dataset.slot = 'sidebar'
    sidebarSlot.style.display = 'contents'
    const sidebarRoot = document.createElement('div')
    sidebarRoot.dataset.dshThemePart = 'shell.sidebar'
    sidebarSlot.append(sidebarRoot)
    sidebarColumn.append(sidebarSlot)
    const rootNode = document.createElement('div')
    document.body.append(sidebarColumn, rootNode)
    const root = createRoot(rootNode)
    const useExperience = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))

    await act(async () => {
      root.render(createElement(SkinExperienceHost, { useExperience }))
      await runtime.install(descriptor, 'bulbasaur')
    })
    const mount = sidebarRoot.querySelector<HTMLElement>('[data-dsh-skin-experience-mount="skin.sidebar.brand"]')
    expect(mount?.textContent).toBe('leaf brand')
    expect(mount?.parentElement).toBe(sidebarRoot)
    expect(sidebarSlot.children).toHaveLength(1)
    const mountStyle = {
      flex: mount?.style.flex,
      minWidth: mount?.style.minWidth,
      maxWidth: mount?.style.maxWidth,
      overflow: mount?.style.overflow,
    }

    await act(async () => { runtime.clear() })
    expect(document.querySelector('[data-dsh-skin-experience-mount]')).toBeNull()
    await act(async () => { root.unmount() })
    expect(mountStyle).toEqual({
      flex: '0 0 auto',
      minWidth: '0px',
      maxWidth: '100%',
      overflow: 'hidden',
    })
  })

  it('switches disjoint shell and component placements without stale overlays or portals', async () => {
    const PikachuTop = (): ReturnType<typeof createElement> => createElement('div', null, 'electric rail')
    const PikachuFloating = (): ReturnType<typeof createElement> => createElement('div', null, 'bolt badge')
    const BulbasaurBrand = (): ReturnType<typeof createElement> => createElement('div', null, 'leaf brand')
    const BulbasaurHero = (): ReturnType<typeof createElement> => createElement('div', null, 'growth hero')
    const modules = new Map<string, unknown>()
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async id => modules.get(id),
      invalidate: id => { modules.delete(id) },
    }, async skin => {
      modules.set(skin.moduleId, skin.moduleId === 'pikachu'
        ? {
          apiVersion: 1,
          components: {
            'skin.shell.top': PikachuTop,
            'skin.shell.floating': PikachuFloating,
          },
        }
        : {
          apiVersion: 1,
          components: {
            'skin.sidebar.brand': BulbasaurBrand,
            'skin.conversation.hero': BulbasaurHero,
          },
        })
    })
    const pikachu: SkinExperienceDescriptor = {
      apiVersion: 1,
      moduleId: 'pikachu',
      url: `/api/dsh-skin/experience/${'b'.repeat(64)}.js`,
      rev: 'b'.repeat(64),
      placements: ['skin.shell.top', 'skin.shell.floating'],
      assets: {},
    }
    const bulbasaur: SkinExperienceDescriptor = {
      apiVersion: 1,
      moduleId: 'bulbasaur',
      url: `/api/dsh-skin/experience/${'c'.repeat(64)}.js`,
      rev: 'c'.repeat(64),
      placements: ['skin.sidebar.brand', 'skin.conversation.hero'],
      assets: {},
    }
    const sidebarColumn = document.createElement('aside')
    const sidebarSlot = document.createElement('div')
    sidebarSlot.dataset.slot = 'sidebar'
    sidebarSlot.style.display = 'contents'
    const sidebarRoot = document.createElement('div')
    sidebarRoot.dataset.dshThemePart = 'shell.sidebar'
    sidebarSlot.append(sidebarRoot)
    sidebarColumn.append(sidebarSlot)
    const conversationSlot = document.createElement('div')
    conversationSlot.dataset.slot = 'conversation'
    conversationSlot.style.display = 'contents'
    const conversationRoot = document.createElement('div')
    conversationRoot.dataset.phase = 'hero'
    conversationRoot.dataset.dshThemePart = 'conversation.root'
    conversationSlot.append(conversationRoot)
    const rootNode = document.createElement('div')
    document.body.append(sidebarColumn, conversationSlot, rootNode)
    const root = createRoot(rootNode)
    const useExperience = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))

    await act(async () => {
      root.render(createElement(SkinExperienceHost, { useExperience }))
      await runtime.install(pikachu, 'pikachu')
    })
    expect(document.querySelector('[data-dsh-skin-experience="skin.shell.top"]')?.textContent).toBe('electric rail')
    expect(document.querySelector('[data-dsh-skin-experience="skin.shell.floating"]')?.textContent).toBe('bolt badge')
    expect(document.querySelector('[data-dsh-skin-experience-mount]')).toBeNull()

    await act(async () => { await runtime.install(bulbasaur, 'bulbasaur') })
    expect(document.querySelector('[data-dsh-skin-experience]')).toBeNull()
    expect(sidebarRoot.querySelector('[data-dsh-skin-experience-mount="skin.sidebar.brand"]')?.textContent).toBe('leaf brand')
    expect(conversationRoot.querySelector('[data-dsh-skin-experience-mount="skin.conversation.hero"]')?.textContent).toBe('growth hero')
    expect(sidebarSlot.children).toHaveLength(1)
    expect(conversationSlot.children).toHaveLength(1)

    await act(async () => { await runtime.install(pikachu, 'pikachu') })
    expect(document.querySelector('[data-dsh-skin-experience-mount]')).toBeNull()
    expect(document.querySelector('[data-dsh-skin-experience="skin.shell.top"]')?.textContent).toBe('electric rail')
    expect(document.querySelector('[data-dsh-skin-experience="skin.shell.floating"]')?.textContent).toBe('bolt badge')

    await act(async () => { root.unmount() })
  })

  it('degrades the sidebar placement to a 36px graphic in the collapsed rail', () => {
    const source = readFileSync(resolve('src/client/SkinExperienceHost.module.css'), 'utf8')
    expect(source).toMatch(/\.sidebarBrand\s*\{[^}]*container-type:\s*inline-size;/s)
    expect(source).toMatch(/@container\s*\(max-width:\s*48px\)/)
    expect(source).toMatch(/\.sidebarBrand\s*>\s*\*\s*\{[^}]*width:\s*36px\s*!important;[^}]*max-width:\s*36px\s*!important;/s)
    expect(source).toMatch(/\.sidebarBrand\s*>\s*\*\s*>\s*i[\s\S]*\.sidebarBrand\s*>\s*\*\s*>\s*div\s*\{[^}]*display:\s*none\s*!important;/s)
  })
})
