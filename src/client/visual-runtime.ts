import type { SkinVisualsV1 } from '../shared/contracts.ts'

export interface ActiveSkinVisuals {
  themeId: string
  mode: 'light' | 'dark'
  visuals: SkinVisualsV1
}

/** Owns the active declarative visual snapshot; it never loads theme code. */
export class SkinVisualRuntime {
  private readonly listeners = new Set<() => void>()
  private snapshotValue: ActiveSkinVisuals | undefined
  private mode: 'light' | 'dark' = 'light'

  getSnapshot = (): ActiveSkinVisuals | undefined => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  install(visuals: SkinVisualsV1, themeId: string): void {
    this.publish(Object.freeze({ themeId, mode: this.mode, visuals }))
  }

  setMode(mode: 'light' | 'dark'): void {
    this.mode = mode
    if (this.snapshotValue === undefined || this.snapshotValue.mode === mode) return
    this.publish(Object.freeze({ ...this.snapshotValue, mode }))
  }

  clear(): void {
    if (this.snapshotValue === undefined) return
    this.publish(undefined)
  }

  private publish(value: ActiveSkinVisuals | undefined): void {
    this.snapshotValue = value
    for (const listener of [...this.listeners]) listener()
  }
}
