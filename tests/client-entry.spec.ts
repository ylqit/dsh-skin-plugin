// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: 'button', Input: 'input', Menu: {}, Modal: {},
}))

import { apply, inject } from '../src/client/index.ts'

describe('client entry compatibility boundary', () => {
  it('does not require the dynamic module service after executable themes are removed', () => {
    expect(inject).not.toContain('modules')
    expect(() => apply({
      theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), setTheme: vi.fn() },
      connection: { isLoopback: true },
      slots: { inject: vi.fn(), register: vi.fn() },
      effect: vi.fn(),
      on: vi.fn(),
    })).not.toThrow()
  })

  it('registers the declarative visual host through the DSH inject hook face', () => {
    const registrations: { options: Record<string, unknown>; component: unknown }[] = []
    apply({
      theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), setTheme: vi.fn() },
      connection: { isLoopback: true },
      slots: {
        inject: (_name: string, setup: () => () => void) => setup(),
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      effect: (setup: () => () => void, label?: string) => {
        if (label?.includes('skin visual decorations') === true) setup()
      },
      on: vi.fn(),
    })
    const visual = registrations.find(entry => entry.options.id === 'dsh-skin-visuals')
    expect(visual).toBeDefined()
    expect((visual?.options.inject as () => Record<string, unknown>)()).toMatchObject({
      hooks: { visuals: expect.objectContaining({ getSnapshot: expect.any(Function) }) },
    })
  })
})
