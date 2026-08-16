// @vitest-environment jsdom
import { act, createElement, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkinVisualHost } from '../src/client/SkinVisualHost.tsx'
import { SkinVisualRuntime } from '../src/client/visual-runtime.ts'
import type { SkinVisualsV1 } from '../src/shared/contracts.ts'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.replaceChildren() })

function config(slot: 'sidebar.brand-mark' | 'conversation.composer-mark', template: 'compact-brand' | 'status-chip'): SkinVisualsV1 {
  return {
    schemaVersion: 1,
    items: [{
      id: 'safe-decoration', slot, template, label: '搭档',
      ...(template === 'status-chip' ? { value: 'READY' } : {}),
      modes: {
        light: { assetUrl: '/api/dsh-skin/assets/a/mark.png', foreground: '#123456', background: '#ffffffcc' },
        dark: { assetUrl: '/api/dsh-skin/assets/a/mark-dark.png', foreground: '#dbeafe', background: '#10243dcc' },
      },
    }],
  }
}

describe('SkinVisualHost', () => {
  it('keeps image marks purely visual even when imported metadata carries text', async () => {
    const conversation = document.createElement('section')
    conversation.dataset.dshThemePart = 'conversation.root'
    conversation.dataset.phase = 'hero'
    const host = document.createElement('div')
    document.body.append(conversation, host)
    const runtime = new SkinVisualRuntime()
    const root = createRoot(host)
    const useVisuals = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))
    await act(async () => {
      root.render(createElement(SkinVisualHost, { useVisuals }))
      runtime.install({ schemaVersion: 1, items: [{
        id: 'water-mark', slot: 'conversation.empty-mark', template: 'image-mark', label: '不应显示', value: 'READY',
        modes: { light: { assetUrl: '/water.png' }, dark: { assetUrl: '/water.png' } },
      }] }, 'water')
    })

    const mark = conversation.querySelector('[data-dsh-skin-visual-template="image-mark"]')
    expect(mark?.querySelector('img')).not.toBeNull()
    expect(mark?.textContent).toBe('')
    await act(async () => { root.unmount() })
  })

  it('renders only plugin-owned templates inside semantic Part anchors', async () => {
    const sidebar = document.createElement('aside')
    sidebar.dataset.dshThemePart = 'shell.sidebar'
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({ width: 280 } as DOMRect)
    const host = document.createElement('div')
    document.body.append(sidebar, host)
    const runtime = new SkinVisualRuntime()
    const root = createRoot(host)
    const useVisuals = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))

    await act(async () => {
      root.render(createElement(SkinVisualHost, { useVisuals }))
      runtime.install(config('sidebar.brand-mark', 'compact-brand'), 'plant-theme')
    })

    const mount = sidebar.querySelector<HTMLElement>('[data-dsh-skin-visual-slot="sidebar.brand-mark"]')
    expect(mount?.querySelector<HTMLElement>('[data-dsh-skin-visual-template]')?.dataset.dshSkinVisualTemplate).toBe('compact-brand')
    expect(mount?.textContent).toContain('搭档')
    expect(mount?.querySelector('img')?.src).toContain('/api/dsh-skin/assets/a/mark.png')
    expect(sidebar.style.containerType).toBe('')
    expect(mount?.dataset.dshSkinVisualCompact).toBe('false')
    expect(document.querySelector('[data-dsh-skin-visual-slot="shell.top"]')).toBeNull()

    await act(async () => { runtime.clear(); root.unmount() })
    expect(document.querySelector('[data-dsh-skin-visual-slot]')).toBeNull()
    expect(sidebar.style.containerType).toBe('')
  })

  it('atomically removes the previous slot when switching themes', async () => {
    const sidebar = document.createElement('aside')
    sidebar.dataset.dshThemePart = 'shell.sidebar'
    const composer = document.createElement('section')
    composer.dataset.dshThemePart = 'conversation.composer'
    vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue({ width: 780 } as DOMRect)
    const host = document.createElement('div')
    document.body.append(sidebar, composer, host)
    const runtime = new SkinVisualRuntime()
    const root = createRoot(host)
    const useVisuals = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))
    await act(async () => {
      root.render(createElement(SkinVisualHost, { useVisuals }))
      runtime.install(config('sidebar.brand-mark', 'compact-brand'), 'first')
    })
    await act(async () => { runtime.install(config('conversation.composer-mark', 'status-chip'), 'second') })

    expect(sidebar.querySelector('[data-dsh-skin-visual-slot]')).toBeNull()
    expect(composer.querySelector('[data-dsh-skin-visual-slot="conversation.composer-mark"]')?.textContent).toContain('READY')
    expect(composer.style.containerType).toBe('')
    expect(composer.querySelector<HTMLElement>('[data-dsh-skin-visual-slot="conversation.composer-mark"]')?.dataset.dshSkinVisualCompact).toBe('false')
    expect(document.querySelectorAll('[data-dsh-skin-visual-slot]')).toHaveLength(1)
    await act(async () => { root.unmount() })
    expect(composer.style.containerType).toBe('')
  })

  it('ignores Studio preview Parts when resolving a live visual slot', async () => {
    const studio = document.createElement('div')
    studio.dataset.dshSkinStudio = 'true'
    const previewComposer = document.createElement('section')
    previewComposer.dataset.dshThemePart = 'conversation.composer'
    studio.append(previewComposer)
    const liveComposer = document.createElement('section')
    liveComposer.dataset.dshThemePart = 'conversation.composer'
    vi.spyOn(liveComposer, 'getBoundingClientRect').mockReturnValue({ width: 780 } as DOMRect)
    const host = document.createElement('div')
    document.body.append(studio, liveComposer, host)
    const runtime = new SkinVisualRuntime()
    const root = createRoot(host)
    const useVisuals = <T,>(selector: (state: ReturnType<typeof runtime.getSnapshot>) => T): T =>
      selector(useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot))

    await act(async () => {
      root.render(createElement(SkinVisualHost, { useVisuals }))
      runtime.install(config('conversation.composer-mark', 'status-chip'), 'electric')
    })

    expect(previewComposer.querySelector('[data-dsh-skin-visual-slot]')).toBeNull()
    expect(liveComposer.querySelector('[data-dsh-skin-visual-slot="conversation.composer-mark"]')).not.toBeNull()
    await act(async () => { root.unmount() })
  })
})
