/**
 * Overlay presenter: one plugin-owned `<style>` node per presentation lane.
 * The compiled CSS already branches on the official `body[data-ds-dark-theme]`
 * signal and on `[data-dsh-theme-preview-mode]` ancestors, so the presenter
 * never scripts light/dark itself — disposing the node fully retracts the lane.
 */

import type { ThemeLayerDefinition } from '../shared/contracts.ts'
import { compileThemeLayerCss } from '../shared/theme-layer.ts'

/** One live presentation lane; `dispose` removes every DOM trace. */
export interface OverlayPresentation {
  fingerprint: string | undefined
  dispose(): void
}

/** Id of the Host-injected first-paint style (src/host/boot.ts). */
const HOST_STYLE_ID = 'dsh-theme-presentation'

/**
 * Present one validated skin layer to the document.
 * Active lanes adopt (remove) the Host's first-paint style so the same CSS is
 * never doubled; preview lanes append after the active style so their rules
 * win the cascade while try-on is live.
 * @param options - lane kind, layer, and bookkeeping marks.
 * @returns the live presentation with a fully retracting disposer.
 */
export function presentSkinLayer(options: {
  kind: 'active' | 'preview'
  layer: ThemeLayerDefinition
  fingerprint?: string
  activationRevision?: number
}): OverlayPresentation {
  const css = compileThemeLayerCss(options.layer)
  const style = document.createElement('style')
  style.setAttribute('data-dsh-skin', options.kind)
  if (options.fingerprint !== undefined) style.setAttribute('data-dsh-skin-fingerprint', options.fingerprint)
  if (options.activationRevision !== undefined) style.setAttribute('data-dsh-skin-revision', String(options.activationRevision))
  style.textContent = css
  if (options.kind === 'active') document.getElementById(HOST_STYLE_ID)?.remove()
  document.head.appendChild(style)
  const bookkeep = options.kind === 'active' ? document.body : undefined
  if (bookkeep !== undefined && options.fingerprint !== undefined) bookkeep.dataset.dshSkinActive = options.fingerprint
  let disposed = false
  return {
    fingerprint: options.fingerprint,
    dispose(): void {
      if (disposed) return
      disposed = true
      style.remove()
      if (bookkeep !== undefined) delete bookkeep.dataset.dshSkinActive
    },
  }
}

/**
 * Rewrite the backdrop flag from the committed layer, decoupled from lane
 * dispose order: activation swaps present-new-before-dispose-old, so a
 * per-lane flag would be deleted by the outgoing lane after the incoming one
 * set it. The part-anchor shim reads this flag to clear the opaque shell
 * surfaces that would otherwise cover the fixed backdrop layer (harness CSS
 * is unlayered, so only inline styles can win over it).
 * @param layer - committed active layer, undefined for the harness default.
 */
export function syncBackdropFlag(layer: ThemeLayerDefinition | undefined): void {
  if (layer?.backdrop !== undefined) document.body.dataset.dshSkinBackdrop = '1'
  else delete document.body.dataset.dshSkinBackdrop
}
