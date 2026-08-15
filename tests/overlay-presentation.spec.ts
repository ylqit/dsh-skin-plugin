// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createSkinBootInjector } from '../src/host/boot.ts'
import { presentSkinLayer } from '../src/client/present.ts'
import type { ThemeLayerDefinition } from '../src/shared/contracts.ts'
import { compileThemeLayerCss } from '../src/shared/theme-layer.ts'

function layer(color: string): ThemeLayerDefinition {
  return {
    tokens: { '--dsw-alias-bg-base': { light: color, dark: '#0b1020' } },
  }
}

function layerWithBackdrop(color: string): ThemeLayerDefinition {
  return {
    ...layer(color),
    backdrop: {
      light: { fallbackColor: color, focusX: 0.5, focusY: 0.5, dim: 0.1, blurPx: 0 },
      dark: { fallbackColor: '#0b1020', focusX: 0.5, focusY: 0.5, dim: 0.4, blurPx: 0 },
    },
  }
}

function activeStyle(): HTMLStyleElement | null {
  return document.querySelector('style[data-dsh-skin="active"]')
}

describe('overlay presentation', () => {
  it('applies one style node per lane and fully retracts on dispose', () => {
    const active = presentSkinLayer({ kind: 'active', layer: layer('#f4f7fb'), fingerprint: 'a'.repeat(64), activationRevision: 3 })
    const preview = presentSkinLayer({ kind: 'preview', layer: layer('#dfe9ff'), fingerprint: 'b'.repeat(64) })

    const activeNode = activeStyle()
    expect(activeNode).not.toBeNull()
    expect(activeNode?.getAttribute('data-dsh-skin-fingerprint')).toBe('a'.repeat(64))
    expect(activeNode?.getAttribute('data-dsh-skin-revision')).toBe('3')
    expect(activeNode?.textContent).toBe(compileThemeLayerCss(layer('#f4f7fb')))
    const previewNode = document.querySelector('style[data-dsh-skin="preview"]')
    expect(previewNode).not.toBeNull()
    // Preview appended after active, so its rules win while try-on is live.
    const nodes = [...document.querySelectorAll('style[data-dsh-skin]')]
    expect(nodes.indexOf(previewNode as HTMLStyleElement)).toBeGreaterThan(nodes.indexOf(activeNode as HTMLStyleElement))
    expect(document.body.dataset.dshSkinActive).toBe('a'.repeat(64))

    preview.dispose()
    expect(document.querySelector('style[data-dsh-skin="preview"]')).toBeNull()
    expect(activeStyle()).not.toBeNull()
    active.dispose()
    active.dispose() // idempotent
    expect(activeStyle()).toBeNull()
    expect(document.body.dataset.dshSkinActive).toBeUndefined()
  })

  it('flags the body while an active lane carries a backdrop and clears it on dispose', () => {
    const plain = presentSkinLayer({ kind: 'active', layer: layer('#f4f7fb'), fingerprint: 'e'.repeat(64) })
    expect(document.body.dataset.dshSkinBackdrop).toBeUndefined()
    plain.dispose()

    const withBackdrop = presentSkinLayer({ kind: 'active', layer: layerWithBackdrop('#f4f7fb'), fingerprint: 'f'.repeat(64) })
    expect(document.body.dataset.dshSkinBackdrop).toBe('1')
    withBackdrop.dispose()
    expect(document.body.dataset.dshSkinBackdrop).toBeUndefined()
  })

  it('adopts the host first-paint style instead of doubling its CSS', () => {
    const hostStyle = document.createElement('style')
    hostStyle.id = 'dsh-theme-presentation'
    hostStyle.textContent = '/* host boot css */'
    document.head.appendChild(hostStyle)

    const presentation = presentSkinLayer({ kind: 'active', layer: layer('#ffffff'), fingerprint: 'c'.repeat(64) })
    expect(document.getElementById('dsh-theme-presentation')).toBeNull()
    expect(activeStyle()?.textContent).toBe(compileThemeLayerCss(layer('#ffffff')))
    presentation.dispose()
  })
})

describe('host first-paint injector', () => {
  const fingerprint = 'd'.repeat(64)
  const boot = { activationRevision: 7, contentFingerprint: fingerprint, layer: layer('#f4f7fb') }
  const baseHtml = '<!doctype html><html><head><title>dsh</title></head><body class="app"><div id="root"></div></body></html>'

  it('injects compiled CSS before </head> and bookkeeping after <body>', () => {
    const inject = createSkinBootInjector(() => boot)
    const html = inject(baseHtml)
    const css = compileThemeLayerCss(boot.layer)
    expect(html).toContain(`<style id="dsh-theme-presentation" data-dsh-skin-fingerprint="${fingerprint}" data-dsh-skin-revision="7">${css}</style></head>`)
    expect(html).toContain('<body class="app"><script>')
    expect(html).toContain(`body.dataset.dshSkinActive = ${JSON.stringify(fingerprint)}`)
    expect(html.indexOf('</head>')).toBeGreaterThan(html.indexOf('dsh-theme-presentation'))
    expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<body'))
  })

  it('leaves HTML untouched without an active skin and caches compiled CSS per fingerprint', () => {
    let current: typeof boot | undefined = boot
    const inject = createSkinBootInjector(() => current)
    const first = inject(baseHtml)
    const second = inject(baseHtml)
    expect(first).toBe(second)
    current = undefined
    expect(inject(baseHtml)).toBe(baseHtml)
  })

  it('handles fragments without head or body anchors', () => {
    const inject = createSkinBootInjector(() => boot)
    const html = inject('<div id="root"></div>')
    expect(html).toContain('dsh-theme-presentation')
    expect(html.endsWith('</script>')).toBe(true)
  })
})
