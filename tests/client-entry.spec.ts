// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: 'button', Input: 'input', Menu: {}, Modal: {},
}))

import { apply, inject } from '../src/client/index.ts'

describe('client entry compatibility boundary', () => {
  it('declares the current DSH module service as mandatory', () => {
    expect(inject).toContain('modules')
    expect(() => apply({
      theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), setTheme: vi.fn() },
      connection: { isLoopback: true },
      slots: { inject: vi.fn(), register: vi.fn() },
      effect: vi.fn(),
      on: vi.fn(),
    })).toThrow(/current DSH|modules/u)
  })

  it('registers the Experience host through the DSH inject hook face', () => {
    const registrations: { options: Record<string, unknown>; component: unknown }[] = []
    apply({
      theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), setTheme: vi.fn() },
      connection: { isLoopback: true },
      modules: { version: 'client', import: vi.fn(), invalidate: vi.fn() },
      slots: {
        inject: (_name: string, setup: () => () => void) => setup(),
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      effect: (setup: () => () => void, label?: string) => {
        if (label?.includes('skin experience decorations') === true) setup()
      },
      on: vi.fn(),
    })
    const experience = registrations.find(entry => entry.options.id === 'dsh-skin-experience')
    expect(experience).toBeDefined()
    expect((experience?.options.inject as () => Record<string, unknown>)()).toMatchObject({
      hooks: { experience: expect.objectContaining({ getSnapshot: expect.any(Function) }) },
    })
  })
})
