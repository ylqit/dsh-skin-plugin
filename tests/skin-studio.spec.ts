// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act, createElement, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkinStudioInjected, StudioSnapshot } from '../src/client/contracts.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: ComponentProps<'button'> & { variant?: string; size?: string }) => createElement('button', props, children),
  Input: (props: ComponentProps<'input'>) => createElement('input', props),
  Menu: ({ anchor, open }: { anchor: ReactNode; open: boolean }) => createElement('div', null, anchor, open ? createElement('div', { role: 'menu' }, 'menu') : null),
  Modal: ({ open, children, title }: { open: boolean; children: ReactNode; title: string }) => open ? createElement('div', { role: 'dialog', 'aria-label': title }, children) : null,
}))

const calls = {
  beginDraft: vi.fn(),
  saveDraft: vi.fn(),
  restoreDefault: vi.fn(),
  resumePreview: vi.fn(),
  setPartEnabled: vi.fn(),
}

const draft = {
  tokens: {
    '--dsw-alias-bg-base': { light: '#ffffff', dark: '#111827' },
  },
  partStyles: [],
} satisfies StudioSnapshot['draft']

const snapshot: StudioSnapshot = {
  host: {
    activationRevision: 7,
    activeFingerprint: 'a'.repeat(64),
    skins: [
      {
        fingerprint: 'a'.repeat(64), id: 'bulbasaur-growth', name: '妙蛙种子生长舱', version: '2.0.0',
        capabilities: ['tokens', 'backdrop', 'component-parts'], source: 'builtin', tags: ['green'],
        description: '绿色植物界面', parts: ['shell.sidebar', 'conversation.composer'],
        preview: { light: '/preview-light.webp', dark: '/preview-dark.webp' },
        experience: { apiVersion: 1, moduleId: 'bulbasaur-growth', url: '/experience.js', rev: 'a'.repeat(64), placements: ['skin.sidebar.brand'], assets: {} },
      },
    ],
  },
  draft,
  draftName: '妙蛙种子副本',
  busy: false,
  previewing: false,
  dirty: true,
  canUndo: true,
  canRedo: false,
  changes: ['组件样式'],
  localManagement: true,
  error: undefined,
  tokens: [{ name: '--dsw-alias-bg-base', description: '基础背景', valueType: 'color', requiresLightAndDark: true }],
  parts: [
    { id: 'app.root', variants: [], states: [], properties: ['background'] },
    { id: 'conversation.composer', variants: ['default'], states: ['focus-visible'], properties: ['background', 'surfaceImage'] },
    { id: 'primitive.menu-item', variants: ['default'], states: ['selected'], properties: ['foreground', 'background'] },
  ],
}

let container: HTMLDivElement
let root: Root

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(element => element.textContent?.includes(name))
  if (match === undefined) throw new Error(`button not found: ${name}`)
  return match
}

async function renderStudio(overrides: Partial<StudioSnapshot> = {}): Promise<void> {
  const { SkinStudio } = await import('../src/client/SkinStudio.tsx')
  const studioSnapshot = { ...snapshot, ...overrides }
  const props: Omit<SkinStudioInjected, 'hooks'> = {
    beginDraft: calls.beginDraft,
    updateDraftName: vi.fn(),
    updateToken: vi.fn(),
    updateBackdrop: vi.fn(),
    updateBackdropImage: vi.fn(),
    upsertPartRule: vi.fn(),
    setPartEnabled: calls.setPartEnabled,
    resetPartProperty: vi.fn(),
    updatePartSurfaceImage: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    importSkin: vi.fn(),
    saveDraft: calls.saveDraft,
    exportDraft: vi.fn(),
    activate: vi.fn(),
    restoreDefault: calls.restoreDefault,
    resumePreview: calls.resumePreview,
    cancelPreview: vi.fn(),
    setColorScheme: vi.fn(),
    deleteSkin: vi.fn(),
  }
  await act(async () => {
    root.render(createElement(SkinStudio, {
      ...props,
      useStudio: <T,>(selector: (value: StudioSnapshot) => T): T => selector(studioSnapshot),
    }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe('SkinStudio workbench', () => {
  it('uses accessible primary/editor tabs and keeps theme metadata in disclosure rows', async () => {
    await renderStudio()

    const primaryTabs = [...container.querySelectorAll('[role="tablist"][aria-label="换肤工作台"] [role="tab"]')]
    expect(primaryTabs.map(element => element.textContent)).toEqual(['主题库', '编辑皮肤'])
    expect(primaryTabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('details')?.textContent).toContain('capabilities')
    expect(container.querySelector('details')?.textContent).toContain('fingerprint')

    await act(async () => {
      primaryTabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(primaryTabs[1]?.getAttribute('aria-selected')).toBe('true')

    const editorTabs = [...container.querySelectorAll('[role="tablist"][aria-label="皮肤编辑分类"] [role="tab"]')]
    expect(editorTabs.map(element => element.textContent)).toEqual(['组件', '色彩 Token', '背景'])
    expect(container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain('应用画布')
  })

  it('shows a real guide and normalized highlight for the selected component', async () => {
    await renderStudio()
    await act(async () => { button('编辑皮肤').click() })

    const guide = container.querySelector<HTMLImageElement>('img[data-part-guide]')
    expect(guide?.getAttribute('src')).toBe('/api/dsh-skin/guides/shell.webp')
    const highlight = container.querySelector<HTMLElement>('[data-part-highlight]')
    expect(highlight?.style.left).toBe('0%')
    expect(highlight?.style.width).toBe('100%')
    expect(container.querySelector('[data-part-availability]')?.textContent).toBe('当前页未出现')
  })

  it('filters the catalog by Chinese label and Part ID', async () => {
    await renderStudio()
    await act(async () => { button('编辑皮肤').click() })
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索组件"]')
    expect(search).not.toBeNull()

    await act(async () => {
      if (search === null) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, '输入框')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const catalog = container.querySelector('nav[aria-label="Theme Parts v2 组件目录"]')
    expect(catalog?.textContent).toContain('conversation.composer')
    expect(catalog?.textContent).not.toContain('primitive.menu-item')

    await act(async () => {
      if (search === null) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'primitive.menu')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(catalog?.textContent).toContain('菜单项')
    expect(catalog?.textContent).not.toContain('conversation.composer')
  })

  it('preserves original management actions in the compact toolbars', async () => {
    await renderStudio()
    await act(async () => { button('恢复 Harness 默认').click() })
    expect(calls.restoreDefault).toHaveBeenCalledOnce()

    await act(async () => { button('编辑与试穿').click() })
    expect(calls.beginDraft).toHaveBeenCalledWith('a'.repeat(64))
    await act(async () => { button('保存到 Host').click() })
    expect(calls.saveDraft).toHaveBeenCalledOnce()
    await act(async () => { button('全页试穿').click() })
    expect(calls.resumePreview).toHaveBeenCalledOnce()
    await act(async () => { button('启用组件换肤').click() })
    expect(calls.setPartEnabled).toHaveBeenCalledWith('app.root', true)
  })
})

describe('SkinStudio layout contract', () => {
  it('bounds the workbench and assigns independent scrolling with a single-column breakpoint', async () => {
    const css = await readFile(join(process.cwd(), 'src/client/SkinStudio.module.css'), 'utf8')
    const source = await readFile(join(process.cwd(), 'src/client/SkinStudio.tsx'), 'utf8')

    expect(css).toMatch(/\.studio\s*\{[^}]*block-size:\s*min\(/s)
    expect(css).toMatch(/\.studio\s*\{[^}]*overflow:\s*hidden/s)
    expect(css).toMatch(/\.libraryGroups\s*\{[^}]*overflow-y:\s*auto/s)
    expect(css).toMatch(/\.partNavigationBody\s*\{[^}]*overflow-y:\s*auto/s)
    expect(css).toMatch(/\.componentDetail\s*\{[^}]*overflow-y:\s*auto/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/)
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*\.componentWorkspace\s*\{[^}]*grid-template-columns:\s*1fr/s)
    expect(source).toMatch(/import \{ THEME_PART_GUIDES(?:,| \})/)
    expect(source).toContain("position: 'fixed'")
    expect(source).toContain('role="tablist"')
  })

  it('lets a compact component directory actually collapse when details is closed', async () => {
    const source = await readFile(join(process.cwd(), 'src/client/SkinStudio.module.css'), 'utf8')
    const bodyRule = source.match(/\.partNavigationBody\s*\{[^}]*\}/s)?.[0] ?? ''
    const closedRule = source.match(/\.partNavigation:not\(\[open\]\)\s+\.partNavigationBody\s*\{[^}]*\}/s)?.[0] ?? ''
    const style = document.createElement('style')
    style.textContent = `${bodyRule}\n${closedRule}`
    document.head.append(style)
    const details = document.createElement('details')
    details.className = 'partNavigation'
    const summary = document.createElement('summary')
    summary.textContent = '组件目录'
    const body = document.createElement('div')
    body.className = 'partNavigationBody'
    details.append(summary, body)
    document.body.append(details)

    try {
      expect(getComputedStyle(body).display).toBe('none')
      details.open = true
      expect(getComputedStyle(body).display).toBe('flex')
    } finally {
      details.remove()
      style.remove()
    }
  })
})
