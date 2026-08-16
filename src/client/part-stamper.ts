/**
 * Part-anchor shim for official dsh builds. The official shell components do
 * not stamp the `data-dsh-theme-part`/`data-dsh-theme-variant` attributes the
 * plugin's Theme Parts v2 CSS targets, so this shim maintains every anchor it can identify from
 * stable structural landmarks — never from generated CSS-module class names.
 * Coverage is best-effort and documented in the README; uncovered parts stay
 * inert instead of matching the wrong elements.
 */

const PART = 'data-dsh-theme-part'
const VARIANT = 'data-dsh-theme-variant'
const STATE = 'data-dsh-theme-state'
const SHIM_OWNED = 'data-dsh-skin-shim'

interface StampedRegistry {
  /** Only attributes written by this plugin, paired with the values it owns. */
  attributes: Map<HTMLElement, Map<string, string>>
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
  const registry: StampedRegistry = { attributes: new Map(), surfaces: new Map() }
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
  stamp(registry, document.body, 'app.root')

  stampStructure(registry)
  stampSubtree(registry, document.body)
  syncBackdropSurfaces(registry)
  const pending = new Set<Element>()
  let structureDirty = false
  let backdropDirty = false
  let disposed = false
  let scheduled = false
  let scheduledFrame: number | undefined
  let scheduledTimer: ReturnType<typeof setTimeout> | undefined
  const observer = new MutationObserver((records) => {
    if (disposed) return
    for (const record of records) {
      if (record.type === 'attributes') {
        backdropDirty = true
        continue
      }
      structureDirty = true
      for (const node of record.addedNodes) {
        if (node instanceof Element) pending.add(node)
      }
    }
    schedule()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [BACKDROP_FLAG],
  })
  function schedule(): void {
    if (disposed || scheduled) return
    scheduled = true
    const run = (): void => {
      scheduled = false
      scheduledFrame = undefined
      scheduledTimer = undefined
      if (disposed) return
      pruneDisconnected(registry)
      for (const element of pending) stampSubtree(registry, element)
      pending.clear()
      if (structureDirty) stampStructure(registry)
      if (structureDirty || backdropDirty) syncBackdropSurfaces(registry)
      structureDirty = false
      backdropDirty = false
    }
    if (typeof requestAnimationFrame === 'function') scheduledFrame = requestAnimationFrame(run)
    else scheduledTimer = setTimeout(run, 16)
  }

  return () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    if (scheduledFrame !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(scheduledFrame)
    }
    if (scheduledTimer !== undefined) clearTimeout(scheduledTimer)
    scheduledFrame = undefined
    scheduledTimer = undefined
    scheduled = false
    pending.clear()
    structureDirty = false
    backdropDirty = false
    backdrop.remove()
    if (root !== undefined && previousRootStyles !== undefined) {
      root.style.position = previousRootStyles.position
      root.style.zIndex = previousRootStyles.zIndex
    }
    for (const [element, attributes] of registry.attributes) {
      for (const [name, value] of attributes) {
        if (element.getAttribute(name) === value) element.removeAttribute(name)
      }
    }
    registry.attributes.clear()
    restoreSurfaces(registry)
  }
}

/** Current DSH structural anchors that do not belong to one added subtree. */
function stampStructure(registry: StampedRegistry): void {
  // Three-column frame: the element hosting the official shell.overlay layer.
  const overlay = document.querySelector(OVERLAY_SELECTOR)
  const frame = overlay?.parentElement ?? undefined
  if (frame !== undefined) {
    const columns = [...frame.children].filter(child => !(child instanceof HTMLElement)
      || (!child.hasAttribute('data-shell-overlay') && !child.hasAttribute('data-side')))
    const sidebarRoot = columns[0]?.querySelector(':scope > [data-slot="sidebar"] > *')
    stamp(registry, sidebarRoot, 'shell.sidebar')
    stamp(registry, columns[1], 'shell.main')
    stamp(registry, columns[2], 'shell.details')
    const center = columns[1]
    if (center !== undefined) {
      stampComposer(center, (element, part) => { stamp(registry, element, part) })
      const conversation = center.querySelector('[data-slot="conversation"] > [data-phase]')
      stamp(registry, conversation, 'conversation.root')
      stamp(registry, conversation?.querySelector('[data-conversation-scroll]'), 'conversation.scroller')
      stamp(registry, conversation?.querySelector('[data-composer-seat]'), 'conversation.composer')
      if (conversation !== null) {
        const header = [...conversation.children].find(child => !child.hasAttribute('data-conversation-scroll'))
        stamp(registry, header, 'conversation.header')
      }
    }
  }
}

/** Stamp only an inserted subtree; streaming chat never triggers a page-wide control scan. */
function stampSubtree(registry: StampedRegistry, root: Element): void {
  const select = (selector: string): Element[] => [
    ...(root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ]

  for (const message of select('[data-chat-anchor-key]')) {
    stamp(registry, message, 'conversation.message')
    stamp(registry, message.firstElementChild, 'conversation.message-content')
    const kind = message.getAttribute('data-chat-flow-kind') ?? ''
    if (kind.includes('user')) ownAttribute(registry, message as HTMLElement, VARIANT, 'user')
    else if (kind.includes('assistant')) ownAttribute(registry, message as HTMLElement, VARIANT, 'assistant')
  }

  for (const card of select('[data-variant="others"], [data-terminal], [data-read], [data-web], [data-search], [data-diff]')) {
    stamp(registry, card, 'tool.card')
    const state = card.getAttribute('data-state') ?? (card.hasAttribute('data-running') ? 'running' : '')
    if (state === 'running' || state === 'ongoing') ownAttribute(registry, card as HTMLElement, STATE, 'running')
    else if (state === 'error') ownAttribute(registry, card as HTMLElement, STATE, 'error')
    else if (state === 'success' || state === 'ok') ownAttribute(registry, card as HTMLElement, STATE, 'success')
  }

  for (const dialog of select('[role="dialog"]')) {
    const settings = dialog.querySelector('nav') !== null
    stamp(registry, dialog, settings ? 'settings.panel' : 'primitive.dialog-surface')
    const mask = dialog.previousElementSibling
    if (mask?.getAttribute('aria-hidden') === 'true') stamp(registry, mask, 'primitive.dialog-mask')
    if (settings) {
      for (const row of dialog.querySelectorAll('nav button')) {
        stamp(registry, row, 'settings.row')
        if (row.getAttribute('aria-current') === 'true') ownAttribute(registry, row as HTMLElement, STATE, 'selected')
      }
    }
  }

  for (const menu of select('[role="menu"], [role="listbox"]')) stamp(registry, menu, 'primitive.menu-surface')
  for (const item of select('[role="menuitem"], [role="option"]')) {
    stamp(registry, item, 'primitive.menu-item')
    if (item.getAttribute('aria-selected') === 'true') ownAttribute(registry, item as HTMLElement, STATE, 'selected')
  }
  for (const tooltip of select('[role="tooltip"]')) stamp(registry, tooltip, 'primitive.tooltip')

  // Generic primitives: stamp every native control without variant/state.
  for (const button of select('button')) stamp(registry, button, 'primitive.button')
  for (const input of select('input, textarea')) {
    stamp(registry, input, 'primitive.input')
    if (input.parentElement?.querySelector('button') === null) stamp(registry, input.parentElement, 'primitive.input-control')
  }
}

function stamp(registry: StampedRegistry, element: Element | null | undefined, part: string): void {
  if (element === null || element === undefined || !(element instanceof HTMLElement)) return
  if (element.hasAttribute(SHIM_OWNED)) return
  ownAttribute(registry, element, PART, part)
}

function ownAttribute(registry: StampedRegistry, element: HTMLElement, name: string, value: string): void {
  if (element.hasAttribute(name)) return
  element.setAttribute(name, value)
  const attributes = registry.attributes.get(element) ?? new Map<string, string>()
  attributes.set(name, value)
  registry.attributes.set(element, attributes)
}

function pruneDisconnected(registry: StampedRegistry): void {
  for (const [element, previous] of [...registry.surfaces]) {
    if (element.isConnected) continue
    restoreSurface(element, previous)
    registry.surfaces.delete(element)
  }
  for (const [element, attributes] of [...registry.attributes]) {
    if (element.isConnected) continue
    for (const [name, value] of attributes) {
      if (element.getAttribute(name) === value) element.removeAttribute(name)
    }
    registry.attributes.delete(element)
  }
}

/**
 * While a backdrop is active, clear the opaque shell surfaces covering the
 * fixed backdrop layer (the AppRoot wrapper and the AppFrame grid). Inline
 * styles are required: the official harness paints those surfaces with
 * unlayered CSS, which beats any layered rule the plugin could ship.
 */
function syncBackdropSurfaces(registry: StampedRegistry): void {
  const surfaces: HTMLElement[] = []
  const overlay = document.querySelector(OVERLAY_SELECTOR)
  const frame = overlay?.parentElement
  if (frame instanceof HTMLElement) {
    surfaces.push(frame)
    // Slot anchors are display:contents and Experience portals can add
    // children. Select the DSH-owned painted roots by their semantic DOM
    // contracts instead of by child position.
    const conversation = frame.querySelector('[data-slot="conversation"] > [data-phase]')
    if (conversation instanceof HTMLElement) surfaces.push(conversation)
    const details = frame.querySelector('[data-slot="details"] > :not([data-dsh-skin-experience-mount])')
    if (details instanceof HTMLElement) surfaces.push(details)
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
  if (element.style.background !== 'transparent') return
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
