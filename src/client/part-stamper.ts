/**
 * Part-anchor shim for official dsh builds. The official shell components do
 * not stamp the `data-dsh-theme-part`/`data-dsh-theme-variant` attributes the
 * compiled part CSS targets (those belong to the unreleased synchronized-skins
 * harness contract), so this shim maintains every anchor it can identify from
 * stable structural landmarks — never from generated CSS-module class names.
 * Coverage is best-effort and documented in the README; uncovered parts stay
 * inert instead of matching the wrong elements.
 */

const PART = 'data-dsh-theme-part'
const SHIM_OWNED = 'data-dsh-skin-shim'

interface StampedRegistry {
  elements: Set<HTMLElement>
  /** Opaque shell surfaces cleared while a backdrop is active, to their previous inline background. */
  surfaces: Map<HTMLElement, string>
}

/** Body flag the presenter sets while the active layer carries a backdrop. */
const BACKDROP_FLAG = 'data-dsh-skin-backdrop'

/** Mount element of the official web shell (`createRoot(el)` on `#root`). */
const ROOT_SELECTOR = '#root'
/** Official overlay layer inside the AppFrame grid (stable data attribute). */
const OVERLAY_SELECTOR = '[data-shell-overlay]'

/**
 * Start stamping part anchors and keep them in sync with shell DOM changes.
 * @returns a disposer that retracts every shim write (observer, backdrop
 * element, inline stacking styles, stamped attributes).
 */
export function startPartStamper(): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => {}
  const registry: StampedRegistry = { elements: new Set(), surfaces: new Map() }
  const backdrop = document.createElement('div')
  backdrop.setAttribute(SHIM_OWNED, 'backdrop')
  backdrop.setAttribute(PART, 'shell.backdrop')
  backdrop.style.position = 'fixed'
  backdrop.style.inset = '0'
  backdrop.style.zIndex = '0'
  backdrop.style.pointerEvents = 'none'
  const root = document.querySelector<HTMLElement>(ROOT_SELECTOR) ?? undefined
  const previousRootStyles = root === undefined
    ? undefined
    : { position: root.style.position, zIndex: root.style.zIndex }
  if (root !== undefined) {
    root.style.position = 'relative'
    root.style.zIndex = '1'
  }
  document.body.insertBefore(backdrop, document.body.firstChild)
  document.body.setAttribute(PART, 'app.root')
  registry.elements.add(document.body)

  sweep(registry)
  const observer = new MutationObserver(() => {
    schedule(registry)
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [BACKDROP_FLAG],
  })
  let scheduled = false
  function schedule(registryValue: StampedRegistry): void {
    if (scheduled) return
    scheduled = true
    const run = (): void => {
      scheduled = false
      sweep(registryValue)
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  return () => {
    observer.disconnect()
    backdrop.remove()
    if (root !== undefined && previousRootStyles !== undefined) {
      root.style.position = previousRootStyles.position
      root.style.zIndex = previousRootStyles.zIndex
    }
    for (const element of registry.elements) {
      if (element.hasAttribute(PART)) element.removeAttribute(PART)
    }
    registry.elements.clear()
    restoreSurfaces(registry)
  }
}

/** One idempotent stamping pass over every supported landmark. */
function sweep(registry: StampedRegistry): void {
  const stamp = (element: Element | null | undefined, part: string): void => {
    if (element === null || element === undefined || !(element instanceof HTMLElement)) return
    if (element.hasAttribute(SHIM_OWNED)) return
    if (element.getAttribute(PART) === part) {
      registry.elements.add(element)
      return
    }
    if (element.hasAttribute(PART)) return // owned by React props or another shim
    element.setAttribute(PART, part)
    registry.elements.add(element)
  }

  // Three-column frame: the element hosting the official shell.overlay layer.
  const overlay = document.querySelector(OVERLAY_SELECTOR)
  const frame = overlay?.parentElement ?? undefined
  if (frame !== undefined) {
    const columns = [...frame.children].filter(child => !(child instanceof HTMLElement)
      || (!child.hasAttribute('data-shell-overlay') && !child.hasAttribute('data-side')))
    stamp(columns[0], 'shell.sidebar')
    stamp(columns[1], 'shell.main')
    stamp(columns[2], 'shell.details')
    const center = columns[1]
    if (center !== undefined) {
      stamp(center.firstElementChild, 'conversation.root')
      stampComposer(center, stamp)
    }
  }

  // Generic primitives: stamp every native control without variant/state.
  for (const button of document.querySelectorAll('button')) stamp(button, 'primitive.button')
  for (const input of document.querySelectorAll('input, textarea')) stamp(input, 'primitive.input')
  for (const dialog of document.querySelectorAll('[role="dialog"]')) stamp(dialog, 'primitive.dialog-surface')

  syncBackdropSurfaces(registry)
}

/**
 * While a backdrop is active, clear the opaque shell surfaces covering the
 * fixed backdrop layer (the AppRoot wrapper and the AppFrame grid). Inline
 * styles are required: the official harness paints those surfaces with
 * unlayered CSS, which beats any layered rule the plugin could ship.
 */
function syncBackdropSurfaces(registry: StampedRegistry): void {
  const surfaces: HTMLElement[] = []
  const root = document.querySelector(ROOT_SELECTOR)
  if (root?.firstElementChild instanceof HTMLElement) surfaces.push(root.firstElementChild)
  const overlay = document.querySelector(OVERLAY_SELECTOR)
  const frame = overlay?.parentElement
  if (frame instanceof HTMLElement) {
    surfaces.push(frame)
    // Content surfaces painted opaque below the frame (conversation/details
    // view roots). data-slot is the stable slots-framework marker.
    for (const slot of frame.querySelectorAll('[data-slot="conversation"], [data-slot="details"]')) {
      if (slot.firstElementChild instanceof HTMLElement) surfaces.push(slot.firstElementChild)
    }
  }
  if (!document.body.hasAttribute(BACKDROP_FLAG)) {
    restoreSurfaces(registry)
    return
  }
  const live = new Set(surfaces)
  for (const [element, previous] of [...registry.surfaces]) {
    if (!live.has(element)) {
      restoreSurface(element, previous)
      registry.surfaces.delete(element)
    }
  }
  for (const element of surfaces) {
    if (!registry.surfaces.has(element)) {
      registry.surfaces.set(element, element.style.background)
      element.style.background = 'transparent'
    }
  }
}

/** Retract every inline background write, newest surface set first. */
function restoreSurfaces(registry: StampedRegistry): void {
  for (const [element, previous] of registry.surfaces) restoreSurface(element, previous)
  registry.surfaces.clear()
}

function restoreSurface(element: HTMLElement, previous: string): void {
  if (previous === '') element.style.removeProperty('background')
  else element.style.background = previous
}

/** Composer: nearest textarea ancestor that also carries a toolbar button. */
function stampComposer(
  center: Element,
  stamp: (element: Element | null | undefined, part: string) => void,
): void {
  for (const textarea of center.querySelectorAll('textarea')) {
    let ancestor = textarea.parentElement
    let depth = 0
    while (ancestor !== null && ancestor !== center && depth < 6) {
      if (ancestor.querySelector('button') !== null) {
        stamp(ancestor, 'conversation.composer')
        return
      }
      ancestor = ancestor.parentElement
      depth += 1
    }
  }
}
