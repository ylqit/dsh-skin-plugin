/**
 * First-paint presentation for the active skin, injected through the official
 * `webServer.tapIndex` hook (stable in official dsh releases; the in-box
 * ui-theme bootstrap uses the same hook). The compiled layer CSS keys off the
 * official `body[data-ds-dark-theme]` signal, so light/dark needs no script.
 */

import type { ThemeLayerV2 } from '../shared/contracts.ts'
import { compileThemeLayerCss } from '../shared/theme-layer.ts'

/** Synchronous active-skin source read from the Host library. */
export interface SkinBootSource {
  activationRevision: number
  contentFingerprint: string
  layer: ThemeLayerV2
}

const STYLE_ID = 'dsh-theme-presentation'
const HEAD_CLOSE = /<\/head>/i
const BODY_OPEN = /<body(?:\s[^>]*)?>/i

/**
 * Build the index-HTML transform that carries the confirmed skin across the
 * pre-plugin interval. Compiled CSS is cached per content fingerprint; the
 * library only bumps fingerprints on commit, so requests reuse the cache.
 * @param readActive - synchronous read of the confirmed selection.
 * @returns an `html => html` transform suitable for `webServer.tapIndex`.
 */
export function createSkinBootInjector(readActive: () => SkinBootSource | undefined): (html: string) => string {
  const cache = new Map<string, string>()
  return (html: string): string => {
    const active = readActive()
    if (active === undefined) return html
    let css = cache.get(active.contentFingerprint)
    if (css === undefined) {
      css = compileThemeLayerCss(active.layer)
      cache.set(active.contentFingerprint, css)
      const oldest = cache.keys().next().value
      if (cache.size > 8 && oldest !== undefined && oldest !== active.contentFingerprint) cache.delete(oldest)
    }
    const style = `<style id="${STYLE_ID}" data-dsh-skin-fingerprint="${active.contentFingerprint}" data-dsh-skin-revision="${String(active.activationRevision)}">${css}</style>`
    const headClose = HEAD_CLOSE.exec(html)
    let output = headClose === null
      ? `${html}${style}`
      : `${html.slice(0, headClose.index)}${style}${html.slice(headClose.index)}`
    // The part-anchor shim needs the backdrop flag before plugins load, so the
    // opaque shell surfaces clear across the pre-plugin interval too.
    const backdropLine = active.layer.backdrop === undefined
      ? 'delete body.dataset.dshSkinBackdrop'
      : 'body.dataset.dshSkinBackdrop = "1"'
    const script = `<script>(() => {
  const body = document.body
  if (body === null) return
  body.dataset.dshSkinActive = ${JSON.stringify(active.contentFingerprint)}
  body.dataset.dshSkinRevision = ${JSON.stringify(String(active.activationRevision))}
  ${backdropLine}
})()</script>`
    const bodyOpen = BODY_OPEN.exec(output)
    output = bodyOpen === null
      ? `${output}${script}`
      : `${output.slice(0, bodyOpen.index + bodyOpen[0].length)}${script}${output.slice(bodyOpen.index + bodyOpen[0].length)}`
    return output
  }
}
