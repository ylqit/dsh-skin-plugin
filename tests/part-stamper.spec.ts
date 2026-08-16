// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPartStamper } from '../src/client/part-stamper.ts'

const PART = 'data-dsh-theme-part'

/** Minimal official-shell fixture: app-root wrapper + frame grid + three columns + composer + controls. */
function buildShellFixture(): void {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.id = 'root'
  const rootSlot = document.createElement('div')
  rootSlot.setAttribute('data-slot', 'root')
  rootSlot.style.display = 'contents'
  const frame = document.createElement('div')
  frame.style.gridTemplateColumns = '256px minmax(0, 1fr) 0px'
  const sidebarColumn = document.createElement('div')
  const sidebarSlot = document.createElement('div')
  sidebarSlot.setAttribute('data-slot', 'sidebar')
  sidebarSlot.style.display = 'contents'
  const sidebarRoot = document.createElement('div')
  sidebarRoot.setAttribute('data-testid', 'sidebar-root')
  sidebarSlot.append(sidebarRoot)
  sidebarColumn.append(sidebarSlot)
  const center = document.createElement('div')
  const details = document.createElement('div')
  const overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  const conversationSlot = document.createElement('div')
  conversationSlot.setAttribute('data-slot', 'conversation')
  conversationSlot.style.display = 'contents'
  const conversation = document.createElement('div')
  conversation.setAttribute('data-phase', 'hero')
  const conversationScroll = document.createElement('div')
  conversationScroll.setAttribute('data-conversation-scroll', '')
  const composer = document.createElement('div')
  composer.setAttribute('data-composer-seat', '')
  const textarea = document.createElement('textarea')
  const toolbarButton = document.createElement('button')
  composer.append(textarea, toolbarButton)
  conversationScroll.append(composer)
  conversation.append(conversationScroll)
  conversationSlot.append(conversation)
  center.append(conversationSlot)
  const standaloneButton = document.createElement('button')
  center.append(standaloneButton)
  frame.append(sidebarColumn, center, details, overlay)
  rootSlot.append(frame)
  root.append(rootSlot)
  document.body.append(root)
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ''
  document.body.removeAttribute('data-dsh-skin-backdrop')
})

describe('part anchor shim', () => {
  it('stamps stable structural landmarks without touching hashed class names', async () => {
    buildShellFixture()
    dispose = startPartStamper()
    // MutationObserver callbacks are queued asynchronously.
    await new Promise(resolve => setTimeout(resolve, 0))

    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    expect(frame).toBeDefined()
    const [sidebarColumn, center, details] = [...(frame as HTMLElement).children] as [Element, Element, Element]
    const sidebarSlot = sidebarColumn.querySelector('[data-slot="sidebar"]')
    const sidebarRoot = sidebarSlot?.firstElementChild
    const conversationSlot = center.querySelector('[data-slot="conversation"]')
    const conversationRoot = conversationSlot?.querySelector(':scope > [data-phase]')
    expect(document.body.getAttribute(PART)).toBe('app.root')
    expect(sidebarRoot?.getAttribute(PART)).toBe('shell.sidebar')
    expect(sidebarColumn.getAttribute(PART)).toBeNull()
    expect(sidebarSlot?.getAttribute(PART)).toBeNull()
    expect(center.getAttribute(PART)).toBe('shell.main')
    expect(details.getAttribute(PART)).toBe('shell.details')
    expect(conversationRoot?.getAttribute(PART)).toBe('conversation.root')
    expect(conversationSlot?.getAttribute(PART)).toBeNull()
    expect(document.querySelector('textarea')?.parentElement?.getAttribute(PART)).toBe('conversation.composer')
    for (const button of document.querySelectorAll('button')) {
      expect(button.getAttribute(PART)).toBe('primitive.button')
    }
    expect(document.querySelector('textarea')?.getAttribute(PART)).toBe('primitive.input')

    const backdrop = document.querySelector(`[${PART}="shell.backdrop"]`)
    expect(backdrop).not.toBeNull()
    expect(backdrop?.hasAttribute('data-dsh-skin-shim')).toBe(true)
    expect(document.querySelector('#root')).not.toBeNull()
  })

  it('re-stamps landmarks added after mount', async () => {
    buildShellFixture()
    dispose = startPartStamper()
    await new Promise(resolve => setTimeout(resolve, 0))
    const late = document.createElement('button')
    document.body.appendChild(late)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(late.getAttribute(PART)).toBe('primitive.button')
  })

  it('stamps an added control without rescanning every control in the document', async () => {
    buildShellFixture()
    dispose = startPartStamper()
    await tick()
    const queryAll = vi.spyOn(document, 'querySelectorAll')
    const late = document.createElement('button')

    document.body.appendChild(late)
    await tick(20)

    expect(late.getAttribute(PART)).toBe('primitive.button')
    expect(queryAll.mock.calls.some(([selector]) => selector === 'button')).toBe(false)
  })

  it('maps current DSH semantic markers to component Parts, variants, and states', async () => {
    document.body.innerHTML = `
      <textarea id="input-phase" data-phase="inert"></textarea>
      <div id="root">
        <div data-slot="root" style="display: contents">
          <div>
            <div></div>
            <div>
              <div data-slot="conversation" style="display: contents">
                <div data-phase="session">
                  <header>Conversation</header>
                  <div data-conversation-scroll>
                    <div data-chat-anchor-key="m1" data-chat-flow-kind="user-message"><div>hello</div></div>
                    <div data-composer-seat><textarea></textarea><button>send</button></div>
                    <div data-variant="others" data-state="running">tool</div>
                  </div>
                </div>
              </div>
            </div>
            <div></div>
            <div data-shell-overlay></div>
          </div>
        </div>
      </div>
      <div role="presentation">
        <div aria-hidden="true"></div>
        <div role="dialog"><nav><button aria-current="true">Appearance</button></nav></div>
      </div>
      <div role="menu"><div role="menuitem" aria-selected="true">Item</div></div>
      <div role="tooltip">Tip</div>
    `
    dispose = startPartStamper()
    await tick()

    expect(document.querySelector('[data-slot="conversation"] > [data-phase]')?.getAttribute(PART)).toBe('conversation.root')
    expect(document.querySelector('[data-slot="conversation"]')?.getAttribute(PART)).toBeNull()
    expect(document.querySelector('#input-phase')?.getAttribute(PART)).toBe('primitive.input')
    expect(document.querySelector('header')?.getAttribute(PART)).toBe('conversation.header')
    expect(document.querySelector('[data-conversation-scroll]')?.getAttribute(PART)).toBe('conversation.scroller')
    expect(document.querySelector('[data-composer-seat]')?.getAttribute(PART)).toBe('conversation.composer')
    expect(document.querySelector('[data-chat-anchor-key]')).toMatchObject({
      dataset: expect.objectContaining({ dshThemePart: 'conversation.message', dshThemeVariant: 'user' }),
    })
    expect(document.querySelector('[data-variant="others"]')).toMatchObject({
      dataset: expect.objectContaining({ dshThemePart: 'tool.card', dshThemeState: 'running' }),
    })
    expect(document.querySelector('[role="dialog"]')?.getAttribute(PART)).toBe('settings.panel')
    expect(document.querySelector('[aria-hidden="true"]')?.getAttribute(PART)).toBe('primitive.dialog-mask')
    expect(document.querySelector('nav button')).toMatchObject({
      dataset: expect.objectContaining({ dshThemePart: 'settings.row', dshThemeState: 'selected' }),
    })
    expect(document.querySelector('[role="menu"]')?.getAttribute(PART)).toBe('primitive.menu-surface')
    expect(document.querySelector('[role="menuitem"]')?.getAttribute(PART)).toBe('primitive.menu-item')
    expect(document.querySelector('[role="tooltip"]')?.getAttribute(PART)).toBe('primitive.tooltip')
  })

  it('preserves Part attributes owned by the DSH component', async () => {
    buildShellFixture()
    const button = document.querySelector('button') as HTMLButtonElement
    button.setAttribute(PART, 'primitive.button')
    dispose = startPartStamper()
    await tick()

    dispose()
    dispose = undefined

    expect(button.getAttribute(PART)).toBe('primitive.button')
  })

  it('retracts plugin attributes when a stamped subtree leaves the DOM', async () => {
    buildShellFixture()
    dispose = startPartStamper()
    await tick()
    const button = document.querySelector('button') as HTMLButtonElement
    expect(button.getAttribute(PART)).toBe('primitive.button')

    button.remove()
    await tick(20)

    expect(button.hasAttribute(PART)).toBe(false)
  })

  it('retracts every shim write on dispose', async () => {
    buildShellFixture()
    dispose = startPartStamper()
    await new Promise(resolve => setTimeout(resolve, 0))
    const root = document.querySelector<HTMLElement>('#root')
    dispose()
    dispose = undefined

    expect(document.querySelector(`[${PART}="shell.backdrop"]`)).toBeNull()
    expect(document.body.hasAttribute(PART)).toBe(false)
    expect(document.querySelectorAll(`[${PART}]`).length).toBe(0)
    expect(document.querySelectorAll('button').length).toBeGreaterThan(0)
    expect(root?.style.position).toBe('')
    expect(root?.style.zIndex).toBe('')
  })

  it('does not stamp queued nodes after disposal', async () => {
    buildShellFixture()
    dispose = startPartStamper()
    await tick()
    const late = document.createElement('button')
    document.body.append(late)
    await tick()

    dispose()
    dispose = undefined
    await tick(30)

    expect(late.hasAttribute(PART)).toBe(false)
  })

  it('clears the opaque shell surfaces while a backdrop is active and restores them after', async () => {
    buildShellFixture()
    const rootSlot = document.querySelector<HTMLElement>('#root > [data-slot="root"]') as HTMLElement
    const frame = document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement as HTMLElement
    const conversationRoot = document.querySelector<HTMLElement>('[data-slot="conversation"] > *') as HTMLElement
    rootSlot.style.background = 'var(--dsw-alias-bg-base)'
    frame.style.background = 'var(--dsw-alias-bg-base)'
    conversationRoot.style.background = 'var(--dsw-alias-bg-base)'
    dispose = startPartStamper()
    await tick()

    // No backdrop flag yet: surfaces keep their own background.
    expect(rootSlot.style.background).toBe('var(--dsw-alias-bg-base)')
    expect(frame.style.background).toBe('var(--dsw-alias-bg-base)')
    expect(conversationRoot.style.background).toBe('var(--dsw-alias-bg-base)')

    document.body.setAttribute('data-dsh-skin-backdrop', '1')
    await tick(20)
    expect(rootSlot.style.background).toBe('var(--dsw-alias-bg-base)')
    expect(frame.style.background).toBe('transparent')
    expect(conversationRoot.style.background).toBe('transparent')

    document.body.removeAttribute('data-dsh-skin-backdrop')
    await tick(20)
    expect(rootSlot.style.background).toBe('var(--dsw-alias-bg-base)')
    expect(frame.style.background).toBe('var(--dsw-alias-bg-base)')
    expect(conversationRoot.style.background).toBe('var(--dsw-alias-bg-base)')
  })

  it('restores surface backgrounds on dispose while a backdrop is active', async () => {
    buildShellFixture()
    const frame = document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement as HTMLElement
    frame.style.background = 'var(--dsw-alias-bg-base)'
    document.body.setAttribute('data-dsh-skin-backdrop', '1')
    dispose = startPartStamper()
    await tick()
    expect(frame.style.background).toBe('transparent')
    dispose()
    dispose = undefined
    expect(frame.style.background).toBe('var(--dsw-alias-bg-base)')
    expect(document.body.hasAttribute('data-dsh-skin-backdrop')).toBe(true) // flag owned by presenter, not shim
  })

  it('does not overwrite a later DSH background write when retracting backdrop transparency', async () => {
    buildShellFixture()
    const frame = document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement as HTMLElement
    frame.style.background = 'var(--dsw-alias-bg-base)'
    document.body.setAttribute('data-dsh-skin-backdrop', '1')
    dispose = startPartStamper()
    await tick()
    expect(frame.style.background).toBe('transparent')

    frame.style.background = 'rgb(1, 2, 3)'
    document.body.removeAttribute('data-dsh-skin-backdrop')
    await tick(20)

    expect(frame.style.background).toBe('rgb(1, 2, 3)')
  })

  it('keeps semantic conversation surfaces transparent when a portal precedes the DSH root', async () => {
    buildShellFixture()
    const slot = document.querySelector<HTMLElement>('[data-slot="conversation"]') as HTMLElement
    const conversationRoot = slot.querySelector<HTMLElement>(':scope > [data-phase]') as HTMLElement
    const portal = document.createElement('div')
    portal.dataset.dshSkinExperienceMount = 'skin.conversation.hero'
    portal.style.background = 'rgb(9, 9, 9)'
    slot.prepend(portal)
    conversationRoot.style.background = 'var(--dsw-alias-bg-base)'
    document.body.setAttribute('data-dsh-skin-backdrop', '1')

    dispose = startPartStamper()
    await tick()

    expect(conversationRoot.style.background).toBe('transparent')
    expect(portal.style.background).toBe('rgb(9, 9, 9)')

    document.body.removeAttribute('data-dsh-skin-backdrop')
    await tick(20)
    expect(conversationRoot.style.background).toBe('var(--dsw-alias-bg-base)')
  })

  it('ignores backdrop surface decoys outside the resolved frame center', async () => {
    buildShellFixture()
    const frame = document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement as HTMLElement
    const sidebarColumn = frame.children[0] as HTMLElement
    const center = frame.children[1] as HTMLElement
    const conversationRoot = center.querySelector<HTMLElement>('[data-slot="conversation"] > [data-phase]') as HTMLElement
    const decoySlot = document.createElement('div')
    decoySlot.dataset.slot = 'conversation'
    const decoy = document.createElement('div')
    decoy.dataset.phase = 'decoy'
    decoySlot.append(decoy)
    sidebarColumn.prepend(decoySlot)
    decoy.style.background = 'rgb(9, 9, 9)'
    conversationRoot.style.background = 'var(--dsw-alias-bg-base)'
    document.body.setAttribute('data-dsh-skin-backdrop', '1')

    dispose = startPartStamper()
    await tick()

    expect(conversationRoot.style.background).toBe('transparent')
    expect(decoy.style.background).toBe('rgb(9, 9, 9)')
  })

  it('restores a detached surface before forgetting ownership and restores it again after reattach', async () => {
    buildShellFixture()
    const slot = document.querySelector<HTMLElement>('[data-slot="conversation"]') as HTMLElement
    const conversationRoot = slot.querySelector<HTMLElement>(':scope > [data-phase]') as HTMLElement
    conversationRoot.style.background = 'var(--dsw-alias-bg-base)'
    document.body.setAttribute('data-dsh-skin-backdrop', '1')
    dispose = startPartStamper()
    await tick()

    conversationRoot.remove()
    await tick(20)
    const detachedBackground = conversationRoot.style.background
    slot.append(conversationRoot)
    await tick(20)
    const reattachedBackground = conversationRoot.style.background

    dispose()
    dispose = undefined
    const disposedBackground = conversationRoot.style.background

    expect(detachedBackground).toBe('var(--dsw-alias-bg-base)')
    expect(reattachedBackground).toBe('transparent')
    expect(disposedBackground).toBe('var(--dsw-alias-bg-base)')
  })

  it('ignores conversation marker decoys outside the resolved frame center', async () => {
    buildShellFixture()
    document.body.insertAdjacentHTML('afterbegin', `
      <div id="decoy-conversation" data-slot="conversation">
        <div data-phase="active">
          <div data-conversation-scroll>
            <div data-composer-seat><textarea></textarea><button>send</button></div>
          </div>
        </div>
      </div>
    `)
    dispose = startPartStamper()
    await tick()

    const frame = document.querySelector('[data-shell-overlay]')?.parentElement as HTMLElement
    const center = frame.children[1] as HTMLElement
    expect(center.querySelector('[data-phase]')?.getAttribute(PART)).toBe('conversation.root')
    expect(center.querySelector('[data-conversation-scroll]')?.getAttribute(PART)).toBe('conversation.scroller')
    expect(center.querySelector('[data-composer-seat]')?.getAttribute(PART)).toBe('conversation.composer')
    expect(document.querySelector('#decoy-conversation [data-phase]')?.getAttribute(PART)).toBeNull()
    expect(document.querySelector('#decoy-conversation [data-conversation-scroll]')?.getAttribute(PART)).toBeNull()
    expect(document.querySelector('#decoy-conversation [data-composer-seat]')?.getAttribute(PART)).toBeNull()
  })
})
