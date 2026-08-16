export const SKIN_SCHEMA_VERSION = 4 as const
export const THEME_SCHEMA_VERSION = 2 as const
export const THEME_PARTS_VERSION = 2 as const
export const SKIN_VISUALS_VERSION = 1 as const
export const PLUGIN_VERSION = '0.4.0' as const
export const SKIN_CAPABILITIES = ['tokens', 'backdrop', 'component-parts', 'component-visuals'] as const
export const VISUAL_SLOT_IDS = [
  'sidebar.brand-mark',
  'conversation.empty-mark',
  'conversation.composer-mark',
  'tool.card-mark',
  'settings.section-mark',
] as const
export const VISUAL_TEMPLATE_KINDS = ['image-mark', 'compact-brand', 'status-chip'] as const

export type VisualSlotId = (typeof VISUAL_SLOT_IDS)[number]
export type VisualTemplateKind = (typeof VISUAL_TEMPLATE_KINDS)[number]
export type SkinSource = 'builtin' | 'local'
export type SkinImportErrorCode = 'UNSUPPORTED_PROTOCOL' | 'INVALID_ARCHIVE' | 'INVALID_ASSET' | 'SECURITY_LIMIT'

export interface SkinImportFailure {
  code: SkinImportErrorCode
  message: string
  field?: string
}

export interface SkinRuntimeCompatibility {
  dshVersion: '0.1.0-rc.5'
  skinSchemaVersion: typeof SKIN_SCHEMA_VERSION
  themeSchemaVersion: typeof THEME_SCHEMA_VERSION
  themePartsVersion: typeof THEME_PARTS_VERSION
  visualsSchemaVersion: typeof SKIN_VISUALS_VERSION
}

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

export interface ThemeSurfaceImage {
  assetUrl: string
  fit: 'cover' | 'contain'
  positionX: number
  positionY: number
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
  surfaceImage?: ThemeSurfaceImage
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

export interface ThemeLayerV2 {
  tokens: Partial<Record<ThemeTokenName, ThemeModePair<string>>>
  backdrop?: ThemeModePair<ThemeBackdropMode>
  partStyles?: readonly ThemePartRule[]
}

export interface SkinAssetManifest {
  path: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  bytes: number
  purpose: 'backdrop' | 'preview' | 'component' | 'visual'
}

export interface SkinPreviewManifest {
  light: string
  dark: string
}

export interface SkinVisualsManifest {
  schemaVersion: typeof SKIN_VISUALS_VERSION
  entry: 'visuals.json'
}

export interface SkinManifestV4 {
  schemaVersion: typeof SKIN_SCHEMA_VERSION
  id: string
  name: string
  version: string
  author?: string
  description?: string
  tags: readonly string[]
  themePartsVersion: typeof THEME_PARTS_VERSION
  capabilities: readonly (typeof SKIN_CAPABILITIES)[number][]
  preview?: SkinPreviewManifest
  assets: readonly SkinAssetManifest[]
  visuals?: SkinVisualsManifest
}

export interface SkinVisualMode {
  assetUrl?: string
  foreground?: ThemeColorValue
  background?: ThemeColorValue
  fit?: 'cover' | 'contain'
  positionX?: number
  positionY?: number
}

export interface SkinVisualItem {
  id: string
  slot: VisualSlotId
  template: VisualTemplateKind
  label?: string
  value?: string
  modes: ThemeModePair<SkinVisualMode>
}

export interface SkinVisualsV1 {
  schemaVersion: typeof SKIN_VISUALS_VERSION
  items: readonly SkinVisualItem[]
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
  parts: readonly ThemePartId[]
  preview?: SkinPreviewUrls
  visualSlots: readonly VisualSlotId[]
}

export interface SkinHostState {
  runtime: {
    pluginVersion: string
    compatibility: SkinRuntimeCompatibility
  }
  activationRevision: number
  activeFingerprint?: string
  previousConfirmed?: string
  activeLayer?: ThemeLayerV2
  activeVisuals?: SkinVisualsV1
  skins: readonly StoredSkinSummary[]
}

export interface SkinDraftDescriptor {
  fingerprint: string
  source: SkinSource
  manifest: SkinManifestV4
  layer: ThemeLayerV2
  visuals?: SkinVisualsV1
}

export interface PrepareSkinResult {
  preparationId: string
  fingerprint?: string
  activationRevision: number
  layer?: ThemeLayerV2
  visuals?: SkinVisualsV1
}

export interface CommitSkinResult {
  fingerprint?: string
  activationRevision: number
  layer?: ThemeLayerV2
  visuals?: SkinVisualsV1
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
