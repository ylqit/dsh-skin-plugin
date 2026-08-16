/**
 * Shared JSON validation and CSS compilation for installable Web UI skins.
 *
 * Internalized verbatim from DeepSeek Harness `packages/client/ui-theme/src/theme-layer.ts`
 * (MIT, https://github.com/deepseek-ai/deepseek-harness) so the skin plugin validates and
 * compiles theme layers without importing any Harness module at runtime. The compiled CSS
 * keys off the official `body[data-ds-dark-theme]` signal and the plugin-owned
 * `/api/dsh-skin/assets/` route, both stable in official dsh releases.
 */

/** Theme component-part contract version understood by this release. */
export const THEME_PARTS_VERSION = 2 as const

/** Semantic tokens that a skin may override. */
export const THEME_TOKEN_NAMES = Object.freeze([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1', '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3', '--dsw-alias-bg-mask-drop',
  '--dsw-alias-bg-mask-photo', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-multi-select', '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-skeleton', '--dsw-alias-border-inverted', '--dsw-alias-border-inverted2', '--dsw-alias-border-l1',
  '--dsw-alias-border-l2', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary', '--dsw-alias-brand-primary-invert', '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-brand-text', '--dsw-alias-button-contrast-fill', '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover', '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-ghost-active-fill', '--dsw-alias-button-ghost-active-hover', '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover', '--dsw-alias-button-primary-dimmed', '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover', '--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-tool-bar-fill-invisible',
  '--dsw-alias-button-tool-bar-hover', '--dsw-alias-interactive-bg-active', '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent', '--dsw-alias-interactive-bg-hover-danger', '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-label-caption', '--dsw-alias-label-dimmed', '--dsw-alias-label-primary', '--dsw-alias-label-primary-bluish',
  '--dsw-alias-label-primary-dimmed', '--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-markdown-citation',
  '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected', '--dsw-alias-markdown-inline-code', '--dsw-alias-markdown-placeholder',
  '--dsw-alias-markdown-tag', '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2', '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary', '--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-success-secondary', '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label', '--dsw-alias-state-warn-primary', '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary', '--dsw-alias-toast-bg', '--dsw-alias-tooltip-bg', '--dsw-specific-bubble',
  '--dsw-specific-bubble-highlight', '--dsw-specific-input-major', '--dsw-specific-login-input', '--dsw-specific-menu',
  '--dsw-specific-selector', '--dsw-specific-sidebar-fill', '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-sidebar-nav-item-active-accent', '--dsw-specific-sidebar-nav-item-hover', '--dsw-specific-tip',
] as const)

/** One semantic token accepted by {@link ThemeLayerV2}. */
export type ThemeTokenName = typeof THEME_TOKEN_NAMES[number]

/** Light and dark values for one theme field. */
export interface ThemeModePair<T> {
  light: T
  dark: T
}

/** A color literal or reference to a registered semantic token. */
export type ThemeColorValue = string | { token: ThemeTokenName }

/** One bounded shadow in a component-part style. */
export interface ThemeShadow {
  inset?: boolean
  xPx: number
  yPx: number
  blurPx: number
  spreadPx: number
  color: ThemeColorValue
}

/** One package-owned image rendered on a component surface. */
export interface ThemeSurfaceImage {
  assetUrl: string
  fit: 'cover' | 'contain'
  positionX: number
  positionY: number
}

/** System font stacks available to skin packages. */
export type ThemeFontFamily = 'system-sans' | 'rounded' | 'serif' | 'monospace'

/** Declarative visual properties accepted for a registered component part. */
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

/** Public component parts available to Theme Parts v2 skins. */
export type ThemePartId =
  | 'app.root' | 'shell.backdrop' | 'shell.sidebar' | 'shell.main' | 'shell.details'
  | 'conversation.root' | 'conversation.header' | 'conversation.scroller'
  | 'conversation.message' | 'conversation.message-content' | 'conversation.composer'
  | 'conversation.composer-toolbar' | 'primitive.button' | 'primitive.input'
  | 'primitive.input-control' | 'primitive.dialog-mask' | 'primitive.dialog-surface'
  | 'primitive.menu-surface' | 'primitive.menu-item' | 'primitive.tooltip'
  | 'tool.card' | 'settings.panel' | 'settings.row'

/** Public component variants available to Theme Parts v2 skins. */
export type ThemePartVariant =
  | 'primary' | 'ghost' | 'outline' | 'toolbar'
  | 'user' | 'assistant' | 'notice' | 'default' | 'compact'

/** Public component states available to Theme Parts v2 skins. */
export type ThemePartState =
  | 'hover' | 'focus-visible' | 'disabled' | 'active' | 'selected'
  | 'collapsed' | 'running' | 'success' | 'error'

/** One component visual rule in an installable skin. */
export interface ThemePartRule {
  part: ThemePartId
  variant?: ThemePartVariant
  state?: ThemePartState
  style: ThemeModePair<ThemePartStyle>
}

/** Background presentation below the Harness shell. */
export interface ThemeBackdropMode {
  assetUrl?: string
  fallbackColor: ThemeColorValue
  focusX: number
  focusY: number
  dim: number
  blurPx: number
}

/** One complete installable skin layer. Omitted entries inherit Harness defaults. */
export interface ThemeLayerV2 {
  tokens: Partial<Record<ThemeTokenName, ThemeModePair<string>>>
  backdrop?: ThemeModePair<ThemeBackdropMode>
  partStyles?: readonly ThemePartRule[]
}

type ThemePartStyleKey = keyof ThemePartStyle

/** Runtime metadata for one public component part. */
export interface ThemePartCatalogEntry {
  variants: readonly ThemePartVariant[]
  states: readonly ThemePartState[]
  properties: readonly ThemePartStyleKey[]
}

const SURFACE_PROPERTIES = Object.freeze([
  'foreground', 'background', 'borderColor', 'borderWidthPx', 'borderStyle',
  'borderRadiusPx', 'shadows', 'opacity', 'backdropBlurPx', 'transitionDurationMs', 'surfaceImage',
] satisfies ThemePartStyleKey[])
const CONTENT_PROPERTIES = Object.freeze([
  ...SURFACE_PROPERTIES, 'paddingBlockPx', 'paddingInlinePx', 'gapPx', 'fontFamily',
  'fontSizePx', 'fontWeight', 'lineHeight', 'letterSpacingPx',
] satisfies ThemePartStyleKey[])
const MASK_PROPERTIES = Object.freeze([
  'background', 'opacity', 'backdropBlurPx', 'transitionDurationMs',
] satisfies ThemePartStyleKey[])
const INTERACTIVE_STATES = Object.freeze([
  'hover', 'focus-visible', 'disabled', 'active',
] satisfies ThemePartState[])

function entry(
  properties: readonly ThemePartStyleKey[],
  variants: readonly ThemePartVariant[] = [],
  states: readonly ThemePartState[] = [],
): ThemePartCatalogEntry {
  return Object.freeze({ variants: Object.freeze([...variants]), states: Object.freeze([...states]), properties })
}

/** Theme Parts v2 part, variant, state, and property allowlist. */
export const THEME_PART_CATALOG: Readonly<Record<ThemePartId, ThemePartCatalogEntry>> = Object.freeze({
  'app.root': entry(SURFACE_PROPERTIES),
  'shell.backdrop': entry(SURFACE_PROPERTIES),
  'shell.sidebar': entry(SURFACE_PROPERTIES, [], ['collapsed']),
  'shell.main': entry(SURFACE_PROPERTIES),
  'shell.details': entry(SURFACE_PROPERTIES),
  'conversation.root': entry(SURFACE_PROPERTIES),
  'conversation.header': entry(CONTENT_PROPERTIES),
  'conversation.scroller': entry(SURFACE_PROPERTIES),
  'conversation.message': entry(CONTENT_PROPERTIES, ['user', 'assistant', 'notice'], ['error']),
  'conversation.message-content': entry(CONTENT_PROPERTIES),
  'conversation.composer': entry(CONTENT_PROPERTIES, [], INTERACTIVE_STATES),
  'conversation.composer-toolbar': entry(CONTENT_PROPERTIES),
  'primitive.button': entry(CONTENT_PROPERTIES, ['primary', 'ghost', 'outline', 'toolbar'], INTERACTIVE_STATES),
  'primitive.input': entry(CONTENT_PROPERTIES, [], INTERACTIVE_STATES),
  'primitive.input-control': entry(CONTENT_PROPERTIES, [], INTERACTIVE_STATES),
  'primitive.dialog-mask': entry(MASK_PROPERTIES),
  'primitive.dialog-surface': entry(CONTENT_PROPERTIES),
  'primitive.menu-surface': entry(CONTENT_PROPERTIES, ['default', 'compact']),
  'primitive.menu-item': entry(CONTENT_PROPERTIES, [], ['hover', 'focus-visible', 'disabled', 'selected']),
  'primitive.tooltip': entry(CONTENT_PROPERTIES),
  'tool.card': entry(CONTENT_PROPERTIES, ['default', 'compact'], ['running', 'success', 'error']),
  'settings.panel': entry(CONTENT_PROPERTIES),
  'settings.row': entry(CONTENT_PROPERTIES, [], ['hover', 'focus-visible', 'disabled', 'selected']),
})

const TOKEN_NAMES = new Set<string>(THEME_TOKEN_NAMES)
const PART_IDS = new Set<string>(Object.keys(THEME_PART_CATALOG))
const STYLE_KEYS = new Set<string>(CONTENT_PROPERTIES)
const PAIR_KEYS = new Set(['light', 'dark'])
const LAYER_KEYS = new Set(['tokens', 'backdrop', 'partStyles'])
const RULE_KEYS = new Set(['part', 'variant', 'state', 'style'])
const BACKDROP_KEYS = new Set(['assetUrl', 'fallbackColor', 'focusX', 'focusY', 'dim', 'blurPx'])
const SHADOW_KEYS = new Set(['inset', 'xPx', 'yPx', 'blurPx', 'spreadPx', 'color'])
const SURFACE_IMAGE_KEYS = new Set(['assetUrl', 'fit', 'positionX', 'positionY'])
const FONT_FAMILIES = new Set<ThemeFontFamily>(['system-sans', 'rounded', 'serif', 'monospace'])
const BORDER_STYLES = new Set(['none', 'solid', 'dashed', 'dotted'])
const FONT_WEIGHTS = new Set([400, 500, 600, 700])
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_COLOR = /^rgba?\((.*)\)$/i
const ASSET_URL = /^(?:\/api\/dsh-skin\/assets\/[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}|blob:[A-Za-z0-9+./:_-]+)$/

function record(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${subject} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, subject: string): void {
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown !== undefined) throw new TypeError(`${subject} contains unsupported field ${JSON.stringify(unknown)}`)
}

function finite(value: unknown, subject: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${subject} must be a finite number from ${String(minimum)} through ${String(maximum)}`)
  }
  return value
}

function modePair<T>(value: unknown, subject: string, decode: (mode: unknown, subject: string) => T): ThemeModePair<T> {
  const pair = record(value, subject)
  exactKeys(pair, PAIR_KEYS, subject)
  if (!Object.hasOwn(pair, 'light') || !Object.hasOwn(pair, 'dark')) throw new TypeError(`${subject} must contain both light and dark`)
  return Object.freeze({ light: decode(pair.light, `${subject}.light`), dark: decode(pair.dark, `${subject}.dark`) })
}

export function validateThemeColorValue(value: unknown, subject: string): ThemeColorValue {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (!isColorLiteral(normalized)) throw new TypeError(`${subject} must be a supported CSS color literal`)
    return normalized
  }
  const reference = record(value, subject)
  exactKeys(reference, new Set(['token']), subject)
  if (typeof reference.token !== 'string' || !TOKEN_NAMES.has(reference.token)) throw new TypeError(`${subject}.token must name a registered semantic token`)
  return Object.freeze({ token: reference.token as ThemeTokenName })
}

function isColorLiteral(value: string): boolean {
  if (value === 'transparent' || value === 'currentcolor' || HEX_COLOR.test(value)) return true
  const rgb = RGB_COLOR.exec(value)
  if (rgb === null) return false
  const values = rgb[1]?.split(',').map(item => item.trim()) ?? []
  const expected = value.startsWith('rgba(') ? 4 : 3
  if (values.length !== expected) return false
  if (!values.slice(0, 3).every(item => /^\d{1,3}$/.test(item) && Number(item) <= 255)) return false
  return expected === 3 || /^(?:0|1|0?\.\d+)$/.test(values[3] ?? '')
}

function shadow(value: unknown, subject: string): ThemeShadow {
  const source = record(value, subject)
  exactKeys(source, SHADOW_KEYS, subject)
  if (source.inset !== undefined && typeof source.inset !== 'boolean') throw new TypeError(`${subject}.inset must be a boolean`)
  return Object.freeze({
    ...(source.inset === undefined ? {} : { inset: source.inset }),
    xPx: finite(source.xPx, `${subject}.xPx`, -32, 32),
    yPx: finite(source.yPx, `${subject}.yPx`, -32, 32),
    blurPx: finite(source.blurPx, `${subject}.blurPx`, 0, 30),
    spreadPx: finite(source.spreadPx, `${subject}.spreadPx`, -8, 16),
    color: validateThemeColorValue(source.color, `${subject}.color`),
  })
}

function surfaceImage(value: unknown, subject: string): ThemeSurfaceImage {
  const source = record(value, subject)
  exactKeys(source, SURFACE_IMAGE_KEYS, subject)
  if (typeof source.assetUrl !== 'string' || !ASSET_URL.test(source.assetUrl)) {
    throw new TypeError(`${subject}.assetUrl must be a managed skin asset URL`)
  }
  if (source.fit !== 'cover' && source.fit !== 'contain') throw new TypeError(`${subject}.fit must be cover or contain`)
  return Object.freeze({
    assetUrl: source.assetUrl,
    fit: source.fit,
    positionX: finite(source.positionX, `${subject}.positionX`, 0, 1),
    positionY: finite(source.positionY, `${subject}.positionY`, 0, 1),
  })
}

function partStyle(value: unknown, subject: string, allowed: ReadonlySet<string>): ThemePartStyle {
  const source = record(value, subject)
  exactKeys(source, STYLE_KEYS, subject)
  const disallowed = Object.keys(source).find(key => !allowed.has(key))
  if (disallowed !== undefined) throw new TypeError(`${subject}.${disallowed} is not available for this part`)
  const output: ThemePartStyle = {}
  if (source.foreground !== undefined) output.foreground = validateThemeColorValue(source.foreground, `${subject}.foreground`)
  if (source.background !== undefined) output.background = validateThemeColorValue(source.background, `${subject}.background`)
  if (source.borderColor !== undefined) output.borderColor = validateThemeColorValue(source.borderColor, `${subject}.borderColor`)
  if (source.borderWidthPx !== undefined) output.borderWidthPx = finite(source.borderWidthPx, `${subject}.borderWidthPx`, 0, 4)
  if (source.borderStyle !== undefined) {
    if (typeof source.borderStyle !== 'string' || !BORDER_STYLES.has(source.borderStyle)) throw new TypeError(`${subject}.borderStyle is unsupported`)
    output.borderStyle = source.borderStyle as NonNullable<ThemePartStyle['borderStyle']>
  }
  if (source.borderRadiusPx !== undefined) output.borderRadiusPx = finite(source.borderRadiusPx, `${subject}.borderRadiusPx`, 0, 32)
  if (source.shadows !== undefined) {
    if (!Array.isArray(source.shadows) || source.shadows.length > 2) throw new TypeError(`${subject}.shadows must contain at most two shadows`)
    output.shadows = Object.freeze(source.shadows.map((item, index) => shadow(item, `${subject}.shadows[${String(index)}]`)))
  }
  if (source.opacity !== undefined) output.opacity = finite(source.opacity, `${subject}.opacity`, 0, 1)
  if (source.backdropBlurPx !== undefined) output.backdropBlurPx = finite(source.backdropBlurPx, `${subject}.backdropBlurPx`, 0, 30)
  if (source.paddingBlockPx !== undefined) output.paddingBlockPx = finite(source.paddingBlockPx, `${subject}.paddingBlockPx`, 0, 24)
  if (source.paddingInlinePx !== undefined) output.paddingInlinePx = finite(source.paddingInlinePx, `${subject}.paddingInlinePx`, 0, 24)
  if (source.gapPx !== undefined) output.gapPx = finite(source.gapPx, `${subject}.gapPx`, 0, 24)
  if (source.fontFamily !== undefined) {
    if (typeof source.fontFamily !== 'string' || !FONT_FAMILIES.has(source.fontFamily as ThemeFontFamily)) throw new TypeError(`${subject}.fontFamily is unsupported`)
    output.fontFamily = source.fontFamily as ThemeFontFamily
  }
  if (source.fontSizePx !== undefined) output.fontSizePx = finite(source.fontSizePx, `${subject}.fontSizePx`, 12, 20)
  if (source.fontWeight !== undefined) {
    if (typeof source.fontWeight !== 'number' || !FONT_WEIGHTS.has(source.fontWeight)) throw new TypeError(`${subject}.fontWeight is unsupported`)
    output.fontWeight = source.fontWeight as NonNullable<ThemePartStyle['fontWeight']>
  }
  if (source.lineHeight !== undefined) output.lineHeight = finite(source.lineHeight, `${subject}.lineHeight`, 1.1, 1.8)
  if (source.letterSpacingPx !== undefined) output.letterSpacingPx = finite(source.letterSpacingPx, `${subject}.letterSpacingPx`, 0, 2)
  if (source.transitionDurationMs !== undefined) output.transitionDurationMs = finite(source.transitionDurationMs, `${subject}.transitionDurationMs`, 0, 400)
  if (source.surfaceImage !== undefined) output.surfaceImage = surfaceImage(source.surfaceImage, `${subject}.surfaceImage`)
  return Object.freeze(output)
}

function backdrop(value: unknown, subject: string): ThemeBackdropMode {
  const source = record(value, subject)
  exactKeys(source, BACKDROP_KEYS, subject)
  if (source.assetUrl !== undefined && (typeof source.assetUrl !== 'string' || !ASSET_URL.test(source.assetUrl))) {
    throw new TypeError(`${subject}.assetUrl must be a managed skin asset URL`)
  }
  return Object.freeze({
    ...(source.assetUrl === undefined ? {} : { assetUrl: source.assetUrl }),
    fallbackColor: validateThemeColorValue(source.fallbackColor, `${subject}.fallbackColor`),
    focusX: finite(source.focusX, `${subject}.focusX`, 0, 1),
    focusY: finite(source.focusY, `${subject}.focusY`, 0, 1),
    dim: finite(source.dim, `${subject}.dim`, 0, 1),
    blurPx: finite(source.blurPx, `${subject}.blurPx`, 0, 30),
  })
}

function tokenValue(value: unknown, subject: string): string {
  if (typeof value !== 'string' || !isColorLiteral(value.toLowerCase())) throw new TypeError(`${subject} must be a supported CSS color literal`)
  return value.toLowerCase()
}

/**
 * Validate and defensively copy an untrusted skin-layer value.
 * @param value - parsed JSON or another untrusted value.
 * @returns an immutable layer accepted by Host and browser runtimes.
 */
export function validateThemeLayer(value: unknown): ThemeLayerV2 {
  const source = record(value, 'theme layer')
  exactKeys(source, LAYER_KEYS, 'theme layer')
  const tokenSource = record(source.tokens, 'theme layer.tokens')
  const tokens: Partial<Record<ThemeTokenName, ThemeModePair<string>>> = {}
  for (const [name, pair] of Object.entries(tokenSource)) {
    if (!TOKEN_NAMES.has(name)) throw new TypeError(`theme layer token ${JSON.stringify(name)} is not registered`)
    tokens[name as ThemeTokenName] = modePair(pair, `theme layer.tokens.${name}`, tokenValue)
  }

  const resolvedBackdrop = source.backdrop === undefined
    ? undefined
    : modePair(source.backdrop, 'theme layer.backdrop', backdrop)
  const rules: ThemePartRule[] = []
  const identities = new Set<string>()
  if (source.partStyles !== undefined) {
    if (!Array.isArray(source.partStyles)) throw new TypeError('theme layer.partStyles must be an array')
    for (let index = 0; index < source.partStyles.length; index += 1) {
      const subject = `theme layer.partStyles[${String(index)}]`
      const ruleSource = record(source.partStyles[index], subject)
      exactKeys(ruleSource, RULE_KEYS, subject)
      if (typeof ruleSource.part !== 'string' || !PART_IDS.has(ruleSource.part)) throw new TypeError(`${subject}.part is not registered`)
      const part = ruleSource.part as ThemePartId
      const catalog = THEME_PART_CATALOG[part]
      if (ruleSource.variant !== undefined && (typeof ruleSource.variant !== 'string' || !catalog.variants.includes(ruleSource.variant as ThemePartVariant))) {
        throw new TypeError(`${subject}.variant is not available for ${part}`)
      }
      if (ruleSource.state !== undefined && (typeof ruleSource.state !== 'string' || !catalog.states.includes(ruleSource.state as ThemePartState))) {
        throw new TypeError(`${subject}.state is not available for ${part}`)
      }
      const identity = `${part}\u0000${String(ruleSource.variant ?? '')}\u0000${String(ruleSource.state ?? '')}`
      if (identities.has(identity)) throw new TypeError(`${subject} duplicates an earlier part, variant, and state rule`)
      identities.add(identity)
      const allowed = new Set<string>(catalog.properties)
      rules.push(Object.freeze({
        part,
        ...(ruleSource.variant === undefined ? {} : { variant: ruleSource.variant as ThemePartVariant }),
        ...(ruleSource.state === undefined ? {} : { state: ruleSource.state as ThemePartState }),
        style: modePair(ruleSource.style, `${subject}.style`, (mode, modeSubject) => partStyle(mode, modeSubject, allowed)),
      }))
    }
  }
  rules.sort((left, right) => ruleIdentity(left).localeCompare(ruleIdentity(right)))
  return Object.freeze({
    tokens: Object.freeze(tokens),
    ...(resolvedBackdrop === undefined ? {} : { backdrop: resolvedBackdrop }),
    ...(rules.length === 0 ? {} : { partStyles: Object.freeze(rules) }),
  })
}

const PROPERTY_ORDER: readonly ThemePartStyleKey[] = Object.freeze([
  'foreground', 'background', 'borderColor', 'borderWidthPx', 'borderStyle', 'borderRadiusPx',
  'shadows', 'opacity', 'backdropBlurPx', 'paddingBlockPx', 'paddingInlinePx', 'gapPx',
  'fontFamily', 'fontSizePx', 'fontWeight', 'lineHeight', 'letterSpacingPx', 'transitionDurationMs',
  'surfaceImage',
])
const FONT_STACKS: Record<ThemeFontFamily, string> = {
  'system-sans': 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  rounded: 'ui-rounded,system-ui,sans-serif',
  serif: 'ui-serif,Georgia,serif',
  monospace: 'ui-monospace,"Cascadia Code",monospace',
}

function ruleIdentity(rule: ThemePartRule): string {
  return `${rule.part}\u0000${rule.variant ?? ''}\u0000${rule.state ?? ''}`
}

function cssColor(value: ThemeColorValue): string {
  return typeof value === 'string' ? value : `var(${value.token})`
}

function declarations(style: ThemePartStyle): string[] {
  const output: string[] = []
  for (const property of PROPERTY_ORDER) {
    const value = style[property]
    if (value === undefined) continue
    if (property === 'foreground') output.push(`color:${cssColor(value as ThemeColorValue)}`)
    else if (property === 'background') output.push(`background-color:${cssColor(value as ThemeColorValue)}`)
    else if (property === 'borderColor') output.push(`border-color:${cssColor(value as ThemeColorValue)}`)
    else if (property === 'borderWidthPx') output.push(`border-width:${String(value)}px`)
    else if (property === 'borderStyle') output.push(`border-style:${String(value)}`)
    else if (property === 'borderRadiusPx') output.push(`border-radius:${String(value)}px`)
    else if (property === 'shadows') {
      const serialized = (value as readonly ThemeShadow[]).map(item => `${item.inset === true ? 'inset ' : ''}${String(item.xPx)}px ${String(item.yPx)}px ${String(item.blurPx)}px ${String(item.spreadPx)}px ${cssColor(item.color)}`)
      output.push(`box-shadow:${serialized.length === 0 ? 'none' : serialized.join(',')}`)
    } else if (property === 'opacity') output.push(`opacity:${String(value)}`)
    else if (property === 'backdropBlurPx') output.push(`backdrop-filter:blur(${String(value)}px)`)
    else if (property === 'paddingBlockPx') output.push(`padding-block:${String(value)}px`)
    else if (property === 'paddingInlinePx') output.push(`padding-inline:${String(value)}px`)
    else if (property === 'gapPx') output.push(`gap:${String(value)}px`)
    else if (property === 'fontFamily') output.push(`font-family:${FONT_STACKS[value as ThemeFontFamily]}`)
    else if (property === 'fontSizePx') output.push(`font-size:${String(value)}px`)
    else if (property === 'fontWeight') output.push(`font-weight:${String(value)}`)
    else if (property === 'lineHeight') output.push(`line-height:${String(value)}`)
    else if (property === 'letterSpacingPx') output.push(`letter-spacing:${String(value)}px`)
    else if (property === 'transitionDurationMs') output.push(`transition-duration:${String(value)}ms`)
    else {
      const image = value as ThemeSurfaceImage
      output.push(`background-image:url("${image.assetUrl}")`)
      output.push(`background-position:${String(image.positionX * 100)}% ${String(image.positionY * 100)}%`)
      output.push(`background-size:${image.fit}`)
      output.push('background-repeat:no-repeat')
    }
  }
  return output
}

function partSelector(rule: ThemePartRule): string {
  let selector = `[data-dsh-theme-part="${rule.part}"]`
  if (rule.variant !== undefined) selector += `[data-dsh-theme-variant~="${rule.variant}"]`
  if (rule.state === 'hover' || rule.state === 'focus-visible' || rule.state === 'active') selector += `:${rule.state}`
  else if (rule.state !== undefined) selector += `[data-dsh-theme-state~="${rule.state}"]`
  return selector
}

function backdropDeclarations(mode: ThemeBackdropMode): string[] {
  const dim = `rgba(0,0,0,${String(mode.dim)})`
  const image = mode.assetUrl === undefined
    ? `linear-gradient(${dim},${dim})`
    : `linear-gradient(${dim},${dim}),url("${mode.assetUrl}")`
  return [
    `background-color:${cssColor(mode.fallbackColor)}`,
    `background-image:${image}`,
    `background-position:${String(mode.focusX * 100)}% ${String(mode.focusY * 100)}%`,
    'background-size:cover',
    `filter:blur(${String(mode.blurPx)}px)`,
  ]
}

/**
 * Compile a skin layer into deterministic light/dark CSS.
 * @param value - a trusted or untrusted layer value; validation always runs.
 * @returns CSS restricted to registered theme attributes and the theme layer.
 */
export function compileThemeLayerCss(value: unknown): string {
  const layer = validateThemeLayer(value)
  const tokens: string[] = []
  const light: string[] = []
  const dark: string[] = []
  const previewLight: string[] = []
  const previewDark: string[] = []
  const lightTokens = Object.entries(layer.tokens).map(([name, pair]) => `${name}:${pair.light}`)
  const darkTokens = Object.entries(layer.tokens).map(([name, pair]) => `${name}:${pair.dark}`)
  // The official shell paints components with unlayered CSS. Every skin rule
  // therefore stays in the same cascade plane and wins through the later
  // presentation style plus the explicit data-part selector.
  if (lightTokens.length > 0) tokens.push(`body:not([data-ds-dark-theme]){${lightTokens.join(';')}}`)
  if (darkTokens.length > 0) tokens.push(`body[data-ds-dark-theme]{${darkTokens.join(';')}}`)
  if (lightTokens.length > 0) tokens.push(`[data-dsh-theme-preview-mode="light"]{${lightTokens.join(';')}}`)
  if (darkTokens.length > 0) tokens.push(`[data-dsh-theme-preview-mode="dark"]{${darkTokens.join(';')}}`)
  if (layer.backdrop !== undefined) {
    light.push(`body:not([data-ds-dark-theme]) [data-dsh-theme-part="shell.backdrop"]{${backdropDeclarations(layer.backdrop.light).join(';')}}`)
    dark.push(`body[data-ds-dark-theme] [data-dsh-theme-part="shell.backdrop"]{${backdropDeclarations(layer.backdrop.dark).join(';')}}`)
    previewLight.push(`body [data-dsh-theme-preview-mode="light"] [data-dsh-theme-part="shell.backdrop"]{${backdropDeclarations(layer.backdrop.light).join(';')}}`)
    previewDark.push(`body [data-dsh-theme-preview-mode="dark"] [data-dsh-theme-part="shell.backdrop"]{${backdropDeclarations(layer.backdrop.dark).join(';')}}`)
  }
  for (const rule of layer.partStyles ?? []) {
    const selector = partSelector(rule)
    const lightDeclarations = declarations(rule.style.light)
    const darkDeclarations = declarations(rule.style.dark)
    if (lightDeclarations.length > 0) light.push(`body:not([data-ds-dark-theme]) ${selector}{${lightDeclarations.join(';')}}`)
    if (darkDeclarations.length > 0) dark.push(`body[data-ds-dark-theme] ${selector}{${darkDeclarations.join(';')}}`)
    if (lightDeclarations.length > 0) previewLight.push(`body [data-dsh-theme-preview-mode="light"] ${selector}{${lightDeclarations.join(';')}}`)
    if (darkDeclarations.length > 0) previewDark.push(`body [data-dsh-theme-preview-mode="dark"] ${selector}{${darkDeclarations.join(';')}}`)
  }
  const reduced = '@media (prefers-reduced-motion:reduce){[data-dsh-theme-part]{transition-duration:0ms}}'
  return `${tokens.join('')}${light.join('')}${dark.join('')}${previewLight.join('')}${previewDark.join('')}${reduced}`
}

/**
 * Compute a stable presentation fingerprint without a Node-only dependency.
 * @param value - skin layer to validate and compile.
 * @returns a deterministic hexadecimal fingerprint for Host/browser handoff.
 */
export function themeLayerFingerprint(value: unknown): string {
  const css = compileThemeLayerCss(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < css.length; index += 1) {
    hash ^= css.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
