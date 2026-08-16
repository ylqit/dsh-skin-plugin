import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SkinPlacement } from '../shared/contracts.ts'
import type { ActiveSkinExperience } from './experience-runtime.ts'
import css from './SkinExperienceHost.module.css'

export interface SkinExperienceHostInjected {
  useExperience<T>(
    selector: (state: ActiveSkinExperience | undefined) => T,
    equal?: (left: T, right: T) => boolean,
  ): T
}

const PORTAL_TARGETS: Partial<Record<SkinPlacement, { selector: string; prepend: boolean }>> = {
  'skin.sidebar.brand': { selector: '[data-dsh-theme-part="shell.sidebar"]', prepend: true },
  'skin.conversation.hero': { selector: '[data-dsh-theme-part="conversation.root"]', prepend: true },
  'skin.composer.decorator': { selector: '[data-dsh-theme-part="conversation.composer"]', prepend: false },
}

/** Renders only plugin-owned decorations; DSH business components remain untouched. */
export function SkinExperienceHost({ useExperience }: SkinExperienceHostInjected): ReactNode {
  const active = useExperience(state => state)
  const mounts = usePlacementMounts(active)
  if (active === undefined) return null
  const props = { themeId: active.themeId, mode: active.mode, assets: active.descriptor.assets }
  const output: ReactNode[] = []
  for (const placement of active.descriptor.placements) {
    const Component = active.components[placement]
    if (Component === undefined) continue
    const component = createElement(Component, props)
    const mount = mounts[placement]
    if (mount !== undefined) {
      output.push(createPortal(component, mount, placement))
      continue
    }
    const className = shellClass(placement)
    if (className !== undefined) {
      output.push(<div key={placement} className={className} data-dsh-skin-experience={placement}>{component}</div>)
    }
  }
  return <div className={css.overlay} data-dsh-skin-experience-host>{output}</div>
}

function usePlacementMounts(active: ActiveSkinExperience | undefined): Partial<Record<SkinPlacement, HTMLElement>> {
  const [mounts, setMounts] = useState<Partial<Record<SkinPlacement, HTMLElement>>>({})
  const placementKey = useMemo(() => active?.descriptor.placements.join('\n') ?? '', [active?.descriptor.placements])
  useEffect(() => {
    const owned = new Map<SkinPlacement, HTMLElement>()
    const placements = new Set(active?.descriptor.placements.filter(placement => PORTAL_TARGETS[placement] !== undefined) ?? [])
    const reconcile = (): void => {
      let changed = false
      for (const [placement, mount] of owned) {
        if (!placements.has(placement) || !mount.isConnected) {
          mount.remove()
          owned.delete(placement)
          changed = true
        }
      }
      for (const placement of placements) {
        if (owned.has(placement)) continue
        const target = document.querySelector<HTMLElement>(PORTAL_TARGETS[placement]!.selector)
        if (target === null) continue
        const mount = document.createElement('div')
        mount.dataset.dshSkinExperienceMount = placement
        mount.className = placement === 'skin.sidebar.brand'
          ? `${css.portal!} ${css.sidebarBrand!}`
          : css.portal!
        mount.style.flex = '0 0 auto'
        mount.style.minWidth = '0'
        mount.style.maxWidth = '100%'
        mount.style.overflow = 'hidden'
        if (PORTAL_TARGETS[placement]!.prepend) target.prepend(mount)
        else target.append(mount)
        owned.set(placement, mount)
        changed = true
      }
      if (changed) setMounts(Object.fromEntries(owned) as Partial<Record<SkinPlacement, HTMLElement>>)
    }
    reconcile()
    const observer = new MutationObserver(reconcile)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const mount of owned.values()) mount.remove()
      setMounts({})
    }
  }, [placementKey])
  return mounts
}

function shellClass(placement: SkinPlacement): string | undefined {
  if (placement === 'skin.shell.top') return css.top
  if (placement === 'skin.shell.bottom') return css.bottom
  if (placement === 'skin.shell.floating') return css.floating
  return undefined
}
