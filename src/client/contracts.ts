import type {
  SkinHostState, ThemeLayerDefinition, ThemePartInspection, ThemeTokenInspection,
} from '../shared/contracts.ts'

export interface HostObservable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ThemeService {
  getTheme(): { skin?: { contentFingerprint?: string; activationRevision?: number } }
  installSkin(source: string, layer: ThemeLayerDefinition, options: {
    kind: 'active' | 'preview'
    contentFingerprint?: string
    activationRevision?: number
  }): () => void
  exportInspectTokens(): ThemeTokenInspection[]
  exportInspectParts(): ThemePartInspection[]
  setTheme(id: 'light' | 'dark' | 'system'): void
}

export interface ClientContext {
  theme: ThemeService
  connection: { isLoopback: boolean }
  slots: {
    inject(name: string, callback: () => (() => void)): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  effect(callback: () => (() => void), label?: string): void
}

export interface StudioSnapshot {
  host: SkinHostState | undefined
  draft: ThemeLayerDefinition
  draftName: string
  busy: boolean
  previewing: boolean
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
  updateBackdropImage(file: File): void
  upsertPartRule(part: string, variant: string, state: string, field: string, light: string, dark: string): void
  importSkin(file: File): void
  saveDraft(): void
  exportDraft(): void
  activate(fingerprint: string): void
  restoreDefault(): void
  cancelPreview(): void
  setColorScheme(mode: 'light' | 'dark'): void
  deleteSkin(fingerprint: string): void
}
