export const SKIN_SCHEMA_VERSION = 1 as const
export const SKIN_SCHEMA_VERSION_V2 = 2 as const
export const THEME_PARTS_VERSION = 1 as const
export const SKIN_CAPABILITIES = ['tokens', 'backdrop', 'component-parts', 'component-experience'] as const
export const SKIN_PLACEMENTS = [
  'skin.shell.top',
  'skin.shell.bottom',
  'skin.shell.floating',
  'skin.sidebar.brand',
  'skin.conversation.hero',
  'skin.composer.decorator',
] as const

export type SkinPlacement = (typeof SKIN_PLACEMENTS)[number]
export type SkinSource = 'builtin' | 'local'

export type ThemeTokenName = string
export type ThemePartId =
  | 'app.root' | 'shell.backdrop' | 'shell.sidebar' | 'shell.main' | 'shell.details'
  | 'conversation.root' | 'conversation.header' | 'conversation.scroller'
  | 'conversation.message' | 'conversation.message-content' | 'conversation.composer'
  | 'conversation.composer-toolbar' | 'primitive.button' | 'primitive.input'
  | 'primitive.input-control' | 'primitive.dialog-mask' | 'primitive.dialog-surface'
  | 'primitive.menu-surface' | 'primitive.menu-item' | 'primitive.tooltip'
  | 'tool.card' | 'settings.panel' | 'settings.row'
export type ThemePartVariant =
  | 'primary' | 'ghost' | 'outline' | 'toolbar'
  | 'user' | 'assistant' | 'notice' | 'default' | 'compact'
export type ThemePartState =
  | 'hover' | 'focus-visible' | 'disabled' | 'active' | 'selected'
  | 'collapsed' | 'running' | 'success' | 'error'
export type ThemeFontFamily = 'system-sans' | 'rounded' | 'serif' | 'monospace'

export interface ThemeModePair<T> {
  light: T
  dark: T
}

export type ThemeColorValue = string | { token: ThemeTokenName }

export interface ThemeShadow {
  inset?: boolean
  xPx: number
  yPx: number
  blurPx: number
  spreadPx: number
  color: ThemeColorValue
}

export interface ThemePartStyle {
  foreground?: ThemeColorValue
  background?: ThemeColorValue
  borderColor?: ThemeColorValue
  borderWidthPx?: number
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted'
  borderRadiusPx?: number
  shadows?: readonly ThemeShadow[]
  opacity?: number
  backdropBlurPx?: number
  paddingBlockPx?: number
  paddingInlinePx?: number
  gapPx?: number
  fontFamily?: ThemeFontFamily
  fontSizePx?: number
  fontWeight?: 400 | 500 | 600 | 700
  lineHeight?: number
  letterSpacingPx?: number
  transitionDurationMs?: number
}

export interface ThemePartRule {
  part: ThemePartId
  variant?: ThemePartVariant
  state?: ThemePartState
  style: ThemeModePair<ThemePartStyle>
}

export interface ThemeBackdropMode {
  assetUrl?: string
  fallbackColor: ThemeColorValue
  focusX: number
  focusY: number
  dim: number
  blurPx: number
}

export interface ThemeLayerDefinition {
  tokens: Partial<Record<ThemeTokenName, ThemeModePair<string>>>
  backdrop?: ThemeModePair<ThemeBackdropMode>
  partStyles?: readonly ThemePartRule[]
}

export interface SkinAssetManifest {
  path: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  bytes: number
  purpose?: 'backdrop' | 'preview' | 'component'
}

export interface SkinManifestV1 {
  schemaVersion: typeof SKIN_SCHEMA_VERSION
  id: string
  name: string
  version: string
  themePartsVersion: typeof THEME_PARTS_VERSION
  capabilities: readonly (typeof SKIN_CAPABILITIES)[number][]
  assets: readonly SkinAssetManifest[]
}

export interface SkinPreviewManifest {
  light: string
  dark: string
}

export interface SkinExperienceManifest {
  apiVersion: 1
  moduleId: string
  entry: 'experience/client.js'
  sha256: string
  bytes: number
  placements: readonly SkinPlacement[]
}

export interface SkinManifestV2 {
  schemaVersion: typeof SKIN_SCHEMA_VERSION_V2
  id: string
  name: string
  version: string
  author?: string
  description?: string
  tags?: readonly string[]
  themePartsVersion: typeof THEME_PARTS_VERSION
  capabilities: readonly (typeof SKIN_CAPABILITIES)[number][]
  preview: SkinPreviewManifest
  assets: readonly SkinAssetManifest[]
  experience?: SkinExperienceManifest
}

export type SkinManifest = SkinManifestV1 | SkinManifestV2

export interface SkinExperienceDescriptor {
  apiVersion: 1
  moduleId: string
  url: string
  rev: string
  placements: readonly SkinPlacement[]
  assets: Readonly<Record<string, string>>
}

export interface SkinPreviewUrls {
  light: string
  dark: string
}

export interface StoredSkinSummary {
  fingerprint: string
  id: string
  name: string
  version: string
  capabilities: readonly string[]
  source: SkinSource
  author?: string
  description?: string
  tags: readonly string[]
  preview?: SkinPreviewUrls
  experience?: SkinExperienceDescriptor
}

export interface SkinHostState {
  activationRevision: number
  activeFingerprint?: string
  previousConfirmed?: string
  activeLayer?: ThemeLayerDefinition
  activeExperience?: SkinExperienceDescriptor
  skins: readonly StoredSkinSummary[]
}

export interface PrepareSkinResult {
  preparationId: string
  fingerprint?: string
  activationRevision: number
  layer?: ThemeLayerDefinition
  experience?: SkinExperienceDescriptor
}

export interface CommitSkinResult {
  fingerprint?: string
  activationRevision: number
  layer?: ThemeLayerDefinition
  experience?: SkinExperienceDescriptor
}

export interface ThemePartInspection {
  id: ThemePartId
  variants: readonly ThemePartVariant[]
  states: readonly ThemePartState[]
  properties: readonly (keyof ThemePartStyle)[]
}

export interface ThemeTokenInspection {
  name: string
  description: string
  valueType: string
  requiresLightAndDark: boolean
  cssVariable?: string
}
