import { useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SkinVisualItem, ThemeColorValue, VisualSlotId } from '../shared/contracts.ts'
import type { ActiveSkinVisuals } from './visual-runtime.ts'
import { VISUAL_SLOT_CATALOG } from './visual-catalog.ts'
import css from './SkinVisualHost.module.css'

export interface SkinVisualHostInjected {
  useVisuals<T>(
    selector: (state: ActiveSkinVisuals | undefined) => T,
    equal?: (left: T, right: T) => boolean,
  ): T
}

/** Renders fixed, plugin-owned visual templates into allowlisted semantic anchors. */
export function SkinVisualHost({ useVisuals }: SkinVisualHostInjected): ReactNode {
  const active = useVisuals(state => state)
  const mounts = useVisualMounts(active)
  if (active === undefined) return null
  return <>{active.visuals.items.map((item) => {
    const mount = mounts[item.slot]
    return mount === undefined ? null : createPortal(
      <VisualTemplate item={item} mode={active.mode} />,
      mount,
      item.id,
    )
  })}</>
}

function VisualTemplate({ item, mode }: { item: SkinVisualItem; mode: 'light' | 'dark' }): ReactNode {
  const values = item.modes[mode]
  const style = {
    ...(values.foreground === undefined ? {} : { '--dsh-skin-visual-fg': cssColor(values.foreground) }),
    ...(values.background === undefined ? {} : { '--dsh-skin-visual-bg': cssColor(values.background) }),
    ...(values.fit === undefined ? {} : { '--dsh-skin-visual-fit': values.fit }),
    '--dsh-skin-visual-position': `${(values.positionX ?? 0.5) * 100}% ${(values.positionY ?? 0.5) * 100}%`,
  } as CSSProperties
  const className = item.template === 'compact-brand'
    ? css.compactBrand
    : item.template === 'status-chip' ? css.statusChip : css.imageMark
  const hasText = item.template !== 'image-mark'
  return <div className={className} style={style} data-dsh-skin-visual-template={item.template}>
    {values.assetUrl === undefined ? null : <img src={values.assetUrl} alt="" draggable={false} />}
    {!hasText || item.label === undefined ? null : <span>{item.label}</span>}
    {item.template !== 'status-chip' || item.value === undefined ? null : <strong>{item.value}</strong>}
  </div>
}

function useVisualMounts(active: ActiveSkinVisuals | undefined): Partial<Record<VisualSlotId, HTMLElement>> {
  const [mounts, setMounts] = useState<Partial<Record<VisualSlotId, HTMLElement>>>({})
  const slotKey = useMemo(
    () => active === undefined ? '' : `${active.themeId}\n${active.visuals.items.map(item => item.slot).join('\n')}`,
    [active],
  )
  useLayoutEffect(() => {
    const owned = new Map<VisualSlotId, {
      mount: HTMLElement
      target: HTMLElement
      previousPosition?: string
      resizeObserver?: ResizeObserver
    }>()
    const desired = new Set(active?.visuals.items.map(item => item.slot) ?? [])
    const reconcile = (): void => {
      let changed = false
      for (const [slot, value] of owned) {
        if (!desired.has(slot) || !value.mount.isConnected || !value.target.isConnected) {
          releaseMount(value)
          owned.delete(slot)
          changed = true
        }
      }
      for (const slot of desired) {
        if (owned.has(slot)) continue
        const target = Array.from(document.querySelectorAll<HTMLElement>(
          `[data-dsh-theme-part="${VISUAL_SLOT_CATALOG[slot].part}"]`,
        )).find(element => element.closest('[data-dsh-skin-studio], [data-dsh-theme-preview-mode]') === null)
        if (target === undefined) continue
        const mount = document.createElement('div')
        mount.dataset.dshSkinVisualSlot = slot
        mount.className = `${css.portal!} ${slotClass(slot)}`
        let previousPosition: string | undefined
        if (getComputedStyle(target).position === 'static') {
          previousPosition = target.style.position
          target.style.position = 'relative'
        }
        const compactThreshold = slot === 'sidebar.brand-mark'
          ? 64
          : slot === 'conversation.composer-mark' ? 640 : undefined
        const syncCompact = compactThreshold === undefined
          ? undefined
          : (): void => {
              mount.dataset.dshSkinVisualCompact = String(target.getBoundingClientRect().width <= compactThreshold)
            }
        syncCompact?.()
        const resizeObserver = syncCompact === undefined || typeof ResizeObserver === 'undefined'
          ? undefined
          : new ResizeObserver(syncCompact)
        resizeObserver?.observe(target)
        target.append(mount)
        owned.set(slot, {
          mount,
          target,
          ...(previousPosition === undefined ? {} : { previousPosition }),
          ...(resizeObserver === undefined ? {} : { resizeObserver }),
        })
        changed = true
      }
      if (changed) setMounts(Object.fromEntries([...owned].map(([slot, value]) => [slot, value.mount])))
    }
    reconcile()
    const observer = new MutationObserver(reconcile)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dsh-theme-part'] })
    return () => {
      observer.disconnect()
      for (const value of owned.values()) releaseMount(value)
    }
  }, [slotKey])
  return mounts
}

function releaseMount(value: {
  mount: HTMLElement
  target: HTMLElement
  previousPosition?: string
  resizeObserver?: ResizeObserver
}): void {
  value.resizeObserver?.disconnect()
  value.mount.remove()
  if (value.previousPosition !== undefined && value.target.style.position === 'relative') {
    value.target.style.position = value.previousPosition
  }
}

function slotClass(slot: VisualSlotId): string {
  if (slot === 'sidebar.brand-mark') return css.sidebar!
  if (slot === 'conversation.empty-mark') return css.empty!
  if (slot === 'conversation.composer-mark') return css.composer!
  if (slot === 'tool.card-mark') return css.tool!
  return css.settings!
}

function cssColor(value: ThemeColorValue): string {
  return typeof value === 'string' ? value : `var(${value.token})`
}
