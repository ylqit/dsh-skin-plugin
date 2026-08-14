import type {
  SkinExperienceDescriptor, SkinHostState, SkinPlacement, ThemeLayerDefinition,
  ThemePartInspection, ThemeTokenInspection,
} from '../shared/contracts.ts'
import type { ComponentType } from 'react'

export interface HostObservable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ThemeService {
  getTheme(): {
    active: { colorScheme: 'light' | 'dark' }
    skin?: { contentFingerprint?: string; activationRevision?: number }
  }
  installSkin(source: string, layer: ThemeLayerDefinition, options: {
    kind: 'active' | 'preview'
    contentFingerprint?: string
    activationRevision?: number
  }): () => void
  exportInspectTokens(): ThemeTokenInspection[]
  exportInspectParts(): ThemePartInspection[]
  setTheme(id: 'light' | 'dark' | 'system'): void
}

export interface ClientDynamicModuleHandle {
  readonly id: string
  readonly exports: unknown
  release(): void
}

export interface ClientModuleLoader {
  loadDynamic(row: { id: string; url: string; rev: string }): Promise<ClientDynamicModuleHandle>
}

export interface SkinExperienceComponentProps {
  themeId: string
  mode: 'light' | 'dark'
  assets: Readonly<Record<string, string>>
}

export interface SkinExperienceModule {
  apiVersion: 1
  components: Partial<Record<SkinPlacement, ComponentType<SkinExperienceComponentProps>>>
}

export interface SkinExperienceSnapshot {
  themeId: string
  mode: 'light' | 'dark'
  assets: Readonly<Record<string, string>>
  components: SkinExperienceModule['components']
}

export interface ClientContext {
  theme: ThemeService
  modules: ClientModuleLoader
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
  updateBackdropImage(mode: 'light' | 'dark', file: File): void
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

export interface SkinPlacementInjected {
  placement: SkinPlacement
  hooks: { experience: HostObservable<SkinExperienceSnapshot | undefined> }
}

export interface LoadedExperience {
  descriptor: SkinExperienceDescriptor
  module: SkinExperienceModule
  handle: ClientDynamicModuleHandle
}
