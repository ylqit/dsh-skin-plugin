import { describe, expect, it, vi } from 'vitest'
import { SkinVisualRuntime } from '../src/client/visual-runtime.ts'
import type { SkinVisualsV1 } from '../src/shared/contracts.ts'

function visuals(label: string): SkinVisualsV1 {
  return {
    schemaVersion: 1,
    items: [{
      id: 'partner-mark', slot: 'sidebar.brand-mark', template: 'compact-brand', label,
      modes: {
        light: { assetUrl: '/api/dsh-skin/assets/a/mark.png', foreground: '#123456' },
        dark: { assetUrl: '/api/dsh-skin/assets/a/mark-dark.png', foreground: '#dbeafe' },
      },
    }],
  }
}

describe('SkinVisualRuntime', () => {
  it('publishes immutable declarative visuals, mode changes and cleanup without loading code', () => {
    const runtime = new SkinVisualRuntime()
    const listener = vi.fn()
    runtime.subscribe(listener)

    runtime.install(visuals('搭档'), 'theme-a')
    expect(runtime.getSnapshot()).toMatchObject({ themeId: 'theme-a', mode: 'light' })
    expect(runtime.getSnapshot()?.visuals.items[0]?.label).toBe('搭档')

    runtime.setMode('dark')
    expect(runtime.getSnapshot()?.mode).toBe('dark')
    runtime.clear()
    expect(runtime.getSnapshot()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('replaces a theme in one synchronous publication', () => {
    const runtime = new SkinVisualRuntime()
    const snapshots: string[] = []
    runtime.subscribe(() => { snapshots.push(runtime.getSnapshot()?.themeId ?? 'default') })
    runtime.install(visuals('A'), 'theme-a')
    runtime.install(visuals('B'), 'theme-b')
    expect(snapshots).toEqual(['theme-a', 'theme-b'])
    expect(runtime.getSnapshot()?.visuals.items[0]?.label).toBe('B')
  })
})
