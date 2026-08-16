// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkinExperienceHost } from '../src/client/SkinExperienceHost.tsx'
import { SkinStudioController } from '../src/client/controller.ts'
import { SkinExperienceRuntime } from '../src/client/experience-runtime.ts'
import { startPartStamper } from '../src/client/part-stamper.ts'
import { parseSkinArchive } from '../src/host/archive.ts'
import type { SkinExperienceDescriptor, SkinHostState } from '../src/shared/contracts.ts'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SkinExperienceHost', () => {
  it('portals owned decorations into current Part anchors and removes every mount on clear', async () => {
    const SidebarBrand = (): ReturnType<typeof createElement> => createElement(
      'div',
      null,
      createElement('i'),
      createElement('div', null, 'leaf brand'),
    )
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
      await runtime.install(descriptor, 'custom-brand')
    })
    const mount = sidebarRoot.querySelector<HTMLElement>('[data-dsh-skin-experience-mount="skin.sidebar.brand"]')
    expect(mount?.textContent).toBe('leaf brand')
    expect(mount?.parentElement).toBe(sidebarRoot)
    expect(sidebarSlot.children).toHaveLength(1)
    const mountVariant = mount?.dataset.dshSkinExperienceVariant
    const matchesBulbasaur = mount?.matches('[data-dsh-skin-experience-variant="bulbasaur-growth"]')
    const mountStyle = {
      flex: mount?.style.flex,
      minWidth: mount?.style.minWidth,
      maxWidth: mount?.style.maxWidth,
      overflow: mount?.style.overflow,
    }
    const bulbasaurDescriptor: SkinExperienceDescriptor = {
      ...descriptor,
      moduleId: 'bulbasaur-brand',
      url: `/api/dsh-skin/experience/${'e'.repeat(64)}.js`,
      rev: 'e'.repeat(64),
    }
    await act(async () => { await runtime.install(bulbasaurDescriptor, 'bulbasaur-growth') })
    const updatedMountVariant = sidebarRoot.querySelector<HTMLElement>(
      '[data-dsh-skin-experience-mount="skin.sidebar.brand"]',
    )?.dataset.dshSkinExperienceVariant

    await act(async () => { runtime.clear() })
    expect(document.querySelector('[data-dsh-skin-experience-mount]')).toBeNull()
    await act(async () => { root.unmount() })
    expect(mountVariant).toBeUndefined()
    expect(matchesBulbasaur).toBe(false)
    expect(updatedMountVariant).toBeUndefined()
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

  it('scopes the 36px collapsed treatment to the built-in Bulbasaur theme', () => {
    const source = readFileSync(resolve('src/client/SkinExperienceHost.module.css'), 'utf8')
    expect(source).toMatch(/\.sidebarBrand\[data-dsh-skin-experience-variant=['"]bulbasaur-growth['"]\]\s*\{[^}]*container-type:\s*inline-size;/s)
    expect(source).toMatch(/@container\s*\(max-width:\s*48px\)/)
    expect(source).toMatch(/\.sidebarBrand\[data-dsh-skin-experience-variant=['"]bulbasaur-growth['"]\]\s*>\s*\*\s*\{[^}]*width:\s*36px\s*!important;[^}]*max-width:\s*36px\s*!important;/s)
    expect(source).not.toMatch(/\.sidebarBrand\s*>\s*\*\s*>\s*(?:i|div)/)
    expect(source).toMatch(/\.sidebarBrand\[data-dsh-skin-experience-variant=['"]bulbasaur-growth['"]\]\s*>\s*\*\s*>\s*i[\s\S]*\.sidebarBrand\[data-dsh-skin-experience-variant=['"]bulbasaur-growth['"]\]\s*>\s*\*\s*>\s*div\s*\{[^}]*display:\s*none\s*!important;/s)
  })

  it('recognizes a Studio copy that preserves the shipped Bulbasaur Experience module', async () => {
    const builtin = parseSkinArchive(new Uint8Array(readFileSync(resolve('builtins/bulbasaur-growth.dshskin'))))
    const builtinDescriptor = builtin.experience as SkinExperienceDescriptor
    const copyFingerprint = 'c'.repeat(64)
    const descriptor: SkinExperienceDescriptor = {
      ...builtinDescriptor,
      url: `/api/dsh-skin/experience/${copyFingerprint}/client.js`,
    }
    const bundle = new TextDecoder().decode(builtin.files.get('experience/client.js'))
    function LeafBrand(): ReturnType<typeof createElement> {
      return createElement('div', null, createElement('i'), createElement('span', null, 'leaf'))
    }
    function GrowthHero(): ReturnType<typeof createElement> {
      return createElement('div', null, 'growth')
    }
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async () => ({
        apiVersion: 1,
        components: {
          'skin.sidebar.brand': LeafBrand,
          'skin.conversation.hero': GrowthHero,
        },
      }),
      invalidate: () => {},
    }, async () => {})
    const sidebarRoot = document.createElement('div')
    sidebarRoot.dataset.dshThemePart = 'shell.sidebar'
    const rootNode = document.createElement('div')
    document.body.append(sidebarRoot, rootNode)
    const root = createRoot(rootNode)
    const useExperience = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))
    const host: SkinHostState = {
      activationRevision: 1,
      activeFingerprint: copyFingerprint,
      activeExperience: descriptor,
      skins: [{
        fingerprint: copyFingerprint,
        id: `${builtin.manifest.id}-custom`,
        name: builtin.manifest.name,
        version: builtin.manifest.version,
        capabilities: builtin.manifest.capabilities,
        source: 'local',
        tags: builtin.manifest.tags ?? [],
        parts: [],
        experience: descriptor,
      }],
    }
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: host }), {
      headers: { 'Content-Type': 'application/json' },
    })))
    const controller = new SkinStudioController({
      getTheme: () => ({ active: { colorScheme: 'light' } }),
      setTheme: vi.fn(),
    }, true, runtime)

    let variant: string | undefined
    let runtimeThemeId: string | undefined
    let disposeController = (): void => {}
    try {
      await act(async () => {
        root.render(createElement(SkinExperienceHost, { useExperience }))
        disposeController = controller.start()
        await vi.waitFor(() => {
          runtimeThemeId = runtime.getSnapshot()?.themeId
          expect(runtimeThemeId).toBe(copyFingerprint)
        })
      })
      variant = sidebarRoot.querySelector<HTMLElement>(
        '[data-dsh-skin-experience-mount="skin.sidebar.brand"]',
      )?.dataset.dshSkinExperienceVariant
    } finally {
      await act(async () => {
        disposeController()
        root.unmount()
      })
    }

    expect(builtin.manifest.id).toBe('bulbasaur-growth')
    expect(builtin.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(builtin.fingerprint).not.toBe('bulbasaur-growth')
    expect(builtinDescriptor.moduleId).toBe('dsh-skin:38903c3b-1fc9-4276-892d-760496ff7a77')
    expect(descriptor.moduleId).toBe(builtinDescriptor.moduleId)
    expect(bundle).toContain('function LeafBrand()')
    expect(bundle).toContain('function GrowthHero(')
    expect(runtimeThemeId).toBe(copyFingerprint)
    expect(variant).toBe('bulbasaur-growth')
  })

  it('does not recognize a different Experience module that reuses the Bulbasaur manifest id', async () => {
    const builtin = parseSkinArchive(new Uint8Array(readFileSync(resolve('builtins/bulbasaur-growth.dshskin'))))
    const fingerprint = 'd'.repeat(64)
    const descriptor: SkinExperienceDescriptor = {
      ...(builtin.experience as SkinExperienceDescriptor),
      moduleId: 'dsh-skin:different-experience-module',
      rev: 'd'.repeat(64),
      url: `/api/dsh-skin/experience/${fingerprint}/client.js`,
    }
    const runtime = new SkinExperienceRuntime({
      version: 'client',
      import: async () => ({
        apiVersion: 1,
        components: {
          'skin.sidebar.brand': (): ReturnType<typeof createElement> => createElement('div', null, 'other brand'),
          'skin.conversation.hero': (): ReturnType<typeof createElement> => createElement('div', null, 'other hero'),
        },
      }),
      invalidate: () => {},
    }, async () => {})
    const sidebarRoot = document.createElement('div')
    sidebarRoot.dataset.dshThemePart = 'shell.sidebar'
    const rootNode = document.createElement('div')
    document.body.append(sidebarRoot, rootNode)
    const root = createRoot(rootNode)
    const useExperience = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))
    const host: SkinHostState = {
      activationRevision: 1,
      activeFingerprint: fingerprint,
      activeExperience: descriptor,
      skins: [{
        fingerprint,
        id: builtin.manifest.id,
        name: builtin.manifest.name,
        version: builtin.manifest.version,
        capabilities: builtin.manifest.capabilities,
        source: 'local',
        tags: builtin.manifest.tags ?? [],
        parts: [],
        experience: descriptor,
      }],
    }
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: host }), {
      headers: { 'Content-Type': 'application/json' },
    })))
    const controller = new SkinStudioController({
      getTheme: () => ({ active: { colorScheme: 'light' } }),
      setTheme: vi.fn(),
    }, true, runtime)

    let disposeController = (): void => {}
    try {
      await act(async () => {
        root.render(createElement(SkinExperienceHost, { useExperience }))
        disposeController = controller.start()
        await vi.waitFor(() => {
          expect(runtime.getSnapshot()?.descriptor.moduleId).toBe(descriptor.moduleId)
        })
      })
      const mount = sidebarRoot.querySelector<HTMLElement>(
        '[data-dsh-skin-experience-mount="skin.sidebar.brand"]',
      )
      expect(mount).not.toBeNull()
      expect(mount?.dataset.dshSkinExperienceVariant).toBeUndefined()
    } finally {
      await act(async () => {
        disposeController()
        root.unmount()
      })
    }
  })

  it('remounts a portal after the part stamper labels a replaced DSH root', async () => {
    const SidebarBrand = (): ReturnType<typeof createElement> => createElement('strong', null, 'resident brand')
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
      moduleId: 'resident-brand',
      url: `/api/dsh-skin/experience/${'d'.repeat(64)}.js`,
      rev: 'd'.repeat(64),
      placements: ['skin.sidebar.brand'],
      assets: {},
    }
    const shellRoot = document.createElement('div')
    shellRoot.id = 'root'
    const rootSlot = document.createElement('div')
    rootSlot.dataset.slot = 'root'
    rootSlot.style.display = 'contents'
    const frame = document.createElement('div')
    const sidebarColumn = document.createElement('div')
    const sidebarSlot = document.createElement('div')
    sidebarSlot.dataset.slot = 'sidebar'
    sidebarSlot.style.display = 'contents'
    const sidebarRoot = document.createElement('div')
    sidebarSlot.append(sidebarRoot)
    sidebarColumn.append(sidebarSlot)
    const center = document.createElement('div')
    const details = document.createElement('div')
    const overlay = document.createElement('div')
    overlay.dataset.shellOverlay = ''
    frame.append(sidebarColumn, center, details, overlay)
    rootSlot.append(frame)
    shellRoot.append(rootSlot)
    const hostNode = document.createElement('div')
    document.body.append(shellRoot, hostNode)
    const disposeStamper = startPartStamper()
    const root = createRoot(hostNode)
    const useExperience = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))

    let replacementPart: string | null = null
    let replacementPortal: string | undefined
    try {
      await act(async () => {
        root.render(createElement(SkinExperienceHost, { useExperience }))
        await runtime.install(descriptor, 'resident-brand')
      })
      const replacement = document.createElement('div')
      await act(async () => {
        sidebarRoot.replaceWith(replacement)
        await tick(40)
      })
      replacementPart = replacement.getAttribute('data-dsh-theme-part')
      replacementPortal = replacement.querySelector<HTMLElement>(
        '[data-dsh-skin-experience-mount="skin.sidebar.brand"]',
      )?.textContent ?? undefined
    } finally {
      await act(async () => { runtime.clear() })
      await act(async () => { root.unmount() })
      disposeStamper()
    }

    expect(replacementPart).toBe('shell.sidebar')
    expect(replacementPortal).toBe('resident brand')
  })
})
