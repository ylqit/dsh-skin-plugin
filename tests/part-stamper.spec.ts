// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { startPartStamper } from '../src/client/part-stamper.ts'

const PART = 'data-dsh-theme-part'

/** Minimal official-shell fixture: frame grid + three columns + composer + controls. */
function buildShellFixture(): void {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.id = 'root'
  const frame = document.createElement('div')
  frame.style.gridTemplateColumns = '256px minmax(0, 1fr) 0px'
  const sidebar = document.createElement('div')
  const center = document.createElement('div')
  const details = document.createElement('div')
  const overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  const conversation = document.createElement('div')
  const composer = document.createElement('div')
  const textarea = document.createElement('textarea')
  const toolbarButton = document.createElement('button')
  composer.append(textarea, toolbarButton)
  conversation.append(composer)
  center.append(conversation)
  const standaloneButton = document.createElement('button')
  center.append(standaloneButton)
  frame.append(sidebar, center, details, overlay)
  root.append(frame)
  document.body.append(root)
}

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ''
})

describe('part anchor shim', () => {
  it('stamps stable structural landmarks without touching hashed class names', async () => {
    buildShellFixture()
    dispose = startPartStamper()
    // MutationObserver callbacks are queued asynchronously.
    await new Promise(resolve => setTimeout(resolve, 0))

    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    expect(frame).toBeDefined()
    const [sidebar, center, details] = [...(frame as HTMLElement).children] as [Element, Element, Element]
    expect(document.body.getAttribute(PART)).toBe('app.root')
    expect(sidebar.getAttribute(PART)).toBe('shell.sidebar')
    expect(center.getAttribute(PART)).toBe('shell.main')
    expect(details.getAttribute(PART)).toBe('shell.details')
    expect(center.firstElementChild?.getAttribute(PART)).toBe('conversation.root')
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
})
