import type {
  SkinHostState, ThemeLayerV2, ThemePartInspection, ThemeTokenInspection,
} from '../shared/contracts.ts'
import type { ClientModuleService } from './experience-runtime.ts'

export interface HostObservable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/**
 * Structural slice of the official ThemeRuntime service (`ctx.theme`,
 * provided by the in-box ui-theme client plugin in every official release).
 * Only surfaces stable in official dsh are declared; skin presentation is
 * owned by this plugin instead of a Harness API.
 */
export interface ThemeService {
  getTheme(): {
    active: { colorScheme: 'light' | 'dark' }
  }
  setTheme(id: 'light' | 'dark' | 'system'): void
}

export interface ClientContext {
  theme: ThemeService
  modules: ClientModuleService
  connection: { isLoopback: boolean }
  slots: {
    inject(name: string, callback: () => (() => void)): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  effect(callback: () => (() => void), label?: string): void
  on(event: 'theme/change', listener: (snapshot: { active: { colorScheme: 'light' | 'dark' } }) => void): () => void
}

export interface StudioSnapshot {
  host: SkinHostState | undefined
  draft: ThemeLayerV2
  draftName: string
  busy: boolean
  previewing: boolean
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  changes: readonly string[]
  localManagement: boolean
  error: string | undefined
  tokens: readonly ThemeTokenInspection[]
  parts: readonly ThemePartInspection[]
}

export interface SkinStudioInjected {
  hooks: { studio: HostObservable<StudioSnapshot> }
  beginDraft(fingerprint?: string): void
  updateDraftName(name: string): void
  updateToken(name: string, mode: 'light' | 'dark', value: string): void
  updateBackdrop(mode: 'light' | 'dark', field: 'fallbackColor' | 'focusX' | 'focusY' | 'dim' | 'blurPx', value: string): void
  updateBackdropImage(mode: 'light' | 'dark', file: File): void
  upsertPartRule(part: string, variant: string, state: string, field: string, light: string, dark: string): void
  setPartEnabled(part: string, enabled: boolean): void
  resetPartProperty(part: string, variant: string, state: string, field: keyof import('../shared/contracts.ts').ThemePartStyle): void
  updatePartSurfaceImage(part: string, variant: string, state: string, mode: 'light' | 'dark', file: File): void
  undo(): void
  redo(): void
  importSkin(file: File): void
  saveDraft(): void
  exportDraft(): void
  activate(fingerprint: string): void
  restoreDefault(): void
  cancelPreview(): void
  setColorScheme(mode: 'light' | 'dark'): void
  deleteSkin(fingerprint: string): void
}
