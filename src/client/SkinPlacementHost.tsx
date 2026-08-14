import { createElement, type ReactNode } from 'react'
import type { SkinExperienceSnapshot, SkinPlacementInjected } from './contracts.ts'

type SkinPlacementHostProps = Omit<SkinPlacementInjected, 'hooks'> & {
  useExperience<T>(
    selector: (snapshot: SkinExperienceSnapshot | undefined) => T,
    equal?: (left: T, right: T) => boolean,
  ): T
}

/** Renders one theme-owned component with a deliberately capability-free prop surface. */
export function SkinPlacementHost(props: SkinPlacementHostProps): ReactNode {
  const snapshot = props.useExperience(value => value)
  const Component = snapshot?.components[props.placement]
  if (snapshot === undefined || Component === undefined) return null
  return createElement(Component, {
    themeId: snapshot.themeId,
    mode: snapshot.mode,
    assets: snapshot.assets,
  })
}
