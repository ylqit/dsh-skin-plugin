import { createHash } from 'node:crypto'
import { unzipSync, type UnzipFileInfo } from 'fflate'
import { validateThemeColorValue, validateThemeLayer } from '../shared/theme-layer.ts'
import {
  SKIN_CAPABILITIES, SKIN_SCHEMA_VERSION, SKIN_VISUALS_VERSION, THEME_PARTS_VERSION, THEME_SCHEMA_VERSION,
  VISUAL_SLOT_IDS, VISUAL_TEMPLATE_KINDS,
  type SkinAssetManifest, type SkinVisualItem, type SkinVisualMode, type SkinVisualsManifest,
  type SkinImportErrorCode,
  type SkinManifestV4,
  type SkinPreviewManifest, type SkinPreviewUrls, type ThemeBackdropMode, type ThemeLayerV2,
  type ThemeSurfaceImage, type VisualSlotId, type VisualTemplateKind, type SkinVisualsV1,
} from '../shared/contracts.ts'

export const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024
const MAX_EXPANDED_BYTES = 48 * 1024 * 1024
const MAX_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_ENTRIES = 48
const MAX_ASSETS = 24
const MAX_VISUALS = VISUAL_SLOT_IDS.length
const MAX_COMPRESSION_RATIO = 200
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true })
const ASSET_PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const HASH = /^[a-f0-9]{64}$/
const VISUALS_ENTRY = 'visuals.json'
const VISUAL_ID = /^[a-z0-9][a-z0-9-]{1,62}$/
const VISUAL_TEMPLATES_BY_SLOT: Readonly<Record<VisualSlotId, readonly VisualTemplateKind[]>> = Object.freeze({
  'sidebar.brand-mark': ['image-mark', 'compact-brand'],
  'conversation.empty-mark': ['image-mark', 'status-chip'],
  'conversation.composer-mark': ['image-mark', 'status-chip'],
  'tool.card-mark': ['image-mark', 'status-chip'],
  'settings.section-mark': ['image-mark', 'status-chip'],
})

export class SkinArchiveError extends TypeError {
  constructor(
    readonly code: SkinImportErrorCode,
    message: string,
    readonly field?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SkinArchiveError'
  }
}
export interface ParsedSkinArchive {
  fingerprint: string
  manifest: SkinManifestV4
  layer: ThemeLayerV2
  preview?: SkinPreviewUrls
  visuals?: SkinVisualsV1
  files: ReadonlyMap<string, Uint8Array>
}

/** Parse and authenticate one .dshskin ZIP before anything reaches disk. */
export function parseSkinArchive(archive: Uint8Array): ParsedSkinArchive {
  try {
    return parseSkinArchiveUnchecked(archive)
  } catch (error) {
    throw stableArchiveError(error)
  }
}

function parseSkinArchiveUnchecked(archive: Uint8Array): ParsedSkinArchive {
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new TypeError(`skin archive must contain 1 through ${String(MAX_ARCHIVE_BYTES)} bytes`)
  }
  let count = 0
  let expanded = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(archive, {
      filter: (entry) => {
        count += 1
        expanded += entry.originalSize
        if (count > MAX_ENTRIES) throw new TypeError(`skin archive must contain at most ${String(MAX_ENTRIES)} entries`)
        if (expanded > MAX_EXPANDED_BYTES) throw new TypeError(`skin archive expands beyond ${String(MAX_EXPANDED_BYTES)} bytes`)
        return inspectZipEntry(entry)
      },
    })
  } catch (error) {
    if (error instanceof TypeError) throw error
    throw new TypeError('skin archive must be a supported ZIP file', { cause: error })
  }
  return parseSkinFilesUnchecked(entries, count)
}

/** Revalidate the persisted immutable file set during Host startup. */
export function parseSkinFiles(
  entries: Record<string, Uint8Array>,
  archiveEntryCount = Object.keys(entries).length,
): ParsedSkinArchive {
  try {
    return parseSkinFilesUnchecked(entries, archiveEntryCount)
  } catch (error) {
    throw stableArchiveError(error)
  }
}

function parseSkinFilesUnchecked(
  entries: Record<string, Uint8Array>,
  archiveEntryCount: number,
): ParsedSkinArchive {
  const names = Object.keys(entries).sort()
  if (names.length !== archiveEntryCount) throw new TypeError('skin archive contains duplicate entry names')
  if (!names.includes('manifest.json') || !names.includes('theme.json')) {
    throw new TypeError('skin archive must contain manifest.json and theme.json')
  }

  const manifest = parseManifest(parseJson(entries['manifest.json'], 'manifest.json'))
  const supportsVisuals = manifest.visuals !== undefined
  const unsupported = names.find(name => name !== 'manifest.json' && name !== 'theme.json'
    && !ASSET_PATH.test(name) && !(supportsVisuals && name === VISUALS_ENTRY))
  if (unsupported !== undefined) throw new TypeError(`skin archive contains unsupported entry ${JSON.stringify(unsupported)}`)

  const themeSource = parseThemeJson(parseJson(entries['theme.json'], 'theme.json'))
  const visualsSource = manifest.visuals === undefined
    ? undefined
    : parseVisualsJson(parseJson(entries[manifest.visuals.entry], manifest.visuals.entry))
  validateAssets(manifest.assets, entries)
  validateCapabilities(manifest, themeSource, visualsSource)
  const fingerprint = fingerprintEntries(entries)
  const layer = rewriteAssetReferences(themeSource, manifest, fingerprint)
  const visuals = visualsSource === undefined ? undefined : rewriteVisualAssetReferences(visualsSource, manifest, fingerprint)
  return Object.freeze({
    fingerprint,
    manifest,
    layer: validateThemeLayer(layer),
    ...(visuals === undefined ? {} : { visuals }),
    ...presentationFields(manifest, fingerprint),
    files: readonlyFiles(entries),
  })
}

function inspectZipEntry(entry: UnzipFileInfo): boolean {
  if (entry.name.endsWith('/')) throw new TypeError('skin archive must not contain directory entries')
  if (entry.name.includes('\\') || entry.name.startsWith('/') || entry.name.split('/').includes('..')) {
    throw new TypeError(`skin archive contains unsafe path ${JSON.stringify(entry.name)}`)
  }
  if (entry.originalSize > MAX_ENTRY_BYTES) throw new TypeError(`skin archive entry ${JSON.stringify(entry.name)} is too large`)
  if (entry.size > 0 && entry.originalSize / entry.size > MAX_COMPRESSION_RATIO) {
    throw new TypeError(`skin archive entry ${JSON.stringify(entry.name)} exceeds the compression-ratio limit`)
  }
  return true
}

function readonlyFiles(entries: Record<string, Uint8Array>): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  for (const [name, bytes] of Object.entries(entries)) files.set(name, bytes.slice())
  return files
}

function parseJson(bytes: Uint8Array | undefined, subject: string): unknown {
  if (bytes === undefined) throw new TypeError(`skin archive is missing ${subject}`)
  try {
    return JSON.parse(JSON_DECODER.decode(bytes)) as unknown
  } catch (error) {
    throw new TypeError(`${subject} must be valid UTF-8 JSON`, { cause: error })
  }
}

function object(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${subject} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], subject: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown !== undefined) throw new TypeError(`${subject} contains unsupported field ${JSON.stringify(unknown)}`)
}

function requiredString(value: unknown, subject: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${subject} must be a non-empty string no longer than ${String(maximum)} characters`)
  }
  return value.trim()
}

function optionalString(value: unknown, subject: string, maximum: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, subject, maximum)
}

function parseManifest(value: unknown): SkinManifestV4 {
  const source = object(value, 'manifest.json')
  if (source.schemaVersion !== SKIN_SCHEMA_VERSION) {
    throw new SkinArchiveError(
      'UNSUPPORTED_PROTOCOL',
      `manifest.json.schemaVersion must be ${String(SKIN_SCHEMA_VERSION)}`,
      'manifest.json.schemaVersion',
    )
  }
  exactKeys(source, [
    'schemaVersion', 'id', 'name', 'version', 'author', 'description', 'tags',
    'themePartsVersion', 'capabilities', 'preview', 'assets', 'visuals',
  ], 'manifest.json')
  if (source.themePartsVersion !== THEME_PARTS_VERSION) {
    throw new SkinArchiveError(
      'UNSUPPORTED_PROTOCOL',
      `manifest.json.themePartsVersion must be ${String(THEME_PARTS_VERSION)}`,
      'manifest.json.themePartsVersion',
    )
  }
  if (!Array.isArray(source.capabilities)) throw new TypeError('manifest.json.capabilities must be an array')
  const capabilities = source.capabilities.map((capability) => {
    if (typeof capability !== 'string' || !(SKIN_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new TypeError(`manifest.json contains unsupported capability ${JSON.stringify(capability)}`)
    }
    return capability as (typeof SKIN_CAPABILITIES)[number]
  })
  if (new Set(capabilities).size !== capabilities.length) throw new TypeError('manifest.json.capabilities contains duplicates')
  if (!Array.isArray(source.assets) || source.assets.length > MAX_ASSETS) {
    throw new TypeError(`manifest.json.assets must contain at most ${String(MAX_ASSETS)} entries`)
  }
  const assets = source.assets.map((asset, index) => parseAsset(asset, index))
  if (new Set(assets.map(asset => asset.path)).size !== assets.length) throw new TypeError('manifest.json.assets contains duplicate paths')
  return Object.freeze({
    schemaVersion: SKIN_SCHEMA_VERSION,
    id: requiredString(source.id, 'manifest.json.id', 80),
    name: requiredString(source.name, 'manifest.json.name', 120),
    version: requiredString(source.version, 'manifest.json.version', 40),
    ...optionalFields(source),
    tags: parseTags(source.tags),
    themePartsVersion: THEME_PARTS_VERSION,
    capabilities: Object.freeze(capabilities),
    assets: Object.freeze(assets),
    ...(source.preview === undefined ? {} : { preview: parsePreview(source.preview) }),
    ...(source.visuals === undefined ? {} : { visuals: parseVisualsManifest(source.visuals) }),
  } satisfies SkinManifestV4)
}

function stableArchiveError(error: unknown): SkinArchiveError {
  if (error instanceof SkinArchiveError) return error
  const message = error instanceof Error ? error.message : String(error)
  const security = /compression-ratio|expands beyond|at most \d+ entries|unsafe|unsupported entry|path traversal|external URL|managed (?:asset|URL)/iu.test(message)
  return new SkinArchiveError(security ? 'SECURITY_LIMIT' : 'INVALID_ARCHIVE', message, undefined, {
    cause: error instanceof Error ? error : undefined,
  })
}

function optionalFields(source: Record<string, unknown>): { author?: string; description?: string } {
  const author = optionalString(source.author, 'manifest.json.author', 120)
  const description = optionalString(source.description, 'manifest.json.description', 500)
  return { ...(author === undefined ? {} : { author }), ...(description === undefined ? {} : { description }) }
}

function parseTags(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 12) throw new TypeError('manifest.json.tags must contain at most twelve strings')
  const tags = value.map((tag, index) => requiredString(tag, `manifest.json.tags[${String(index)}]`, 40))
  if (new Set(tags).size !== tags.length) throw new TypeError('manifest.json.tags contains duplicates')
  return Object.freeze(tags)
}

function parsePreview(value: unknown): SkinPreviewManifest {
  const source = object(value, 'manifest.json.preview')
  exactKeys(source, ['light', 'dark'], 'manifest.json.preview')
  return Object.freeze({
    light: `asset:${assetReference(source.light, 'manifest.json.preview.light')}`,
    dark: `asset:${assetReference(source.dark, 'manifest.json.preview.dark')}`,
  })
}

function parseVisualsManifest(value: unknown): SkinVisualsManifest {
  const source = object(value, 'manifest.json.visuals')
  exactKeys(source, ['schemaVersion', 'entry'], 'manifest.json.visuals')
  if (source.schemaVersion !== SKIN_VISUALS_VERSION) {
    throw new SkinArchiveError(
      'UNSUPPORTED_PROTOCOL',
      `manifest.json.visuals.schemaVersion must be ${String(SKIN_VISUALS_VERSION)}`,
      'manifest.json.visuals.schemaVersion',
    )
  }
  if (source.entry !== VISUALS_ENTRY) throw new TypeError(`manifest.json.visuals.entry must be ${VISUALS_ENTRY}`)
  return Object.freeze({ schemaVersion: SKIN_VISUALS_VERSION, entry: VISUALS_ENTRY })
}

function parseAsset(value: unknown, index: number): SkinAssetManifest {
  const subject = `manifest.json.assets[${String(index)}]`
  const source = object(value, subject)
  exactKeys(source, ['path', 'mimeType', 'sha256', 'bytes', 'purpose'], subject)
  if (typeof source.path !== 'string' || !ASSET_PATH.test(source.path)) throw new TypeError(`${subject}.path is unsafe`)
  if (source.mimeType !== 'image/jpeg' && source.mimeType !== 'image/png' && source.mimeType !== 'image/webp') {
    throw new TypeError(`${subject}.mimeType is unsupported`)
  }
  if (typeof source.sha256 !== 'string' || !HASH.test(source.sha256)) throw new TypeError(`${subject}.sha256 must be lowercase SHA-256`)
  if (!Number.isSafeInteger(source.bytes) || (source.bytes as number) < 1 || (source.bytes as number) > MAX_ENTRY_BYTES) {
    throw new TypeError(`${subject}.bytes is outside the accepted range`)
  }
  if (source.purpose !== 'backdrop' && source.purpose !== 'preview' && source.purpose !== 'component' && source.purpose !== 'visual') {
    throw new TypeError(`${subject}.purpose is unsupported`)
  }
  return Object.freeze({
    path: source.path,
    mimeType: source.mimeType,
    sha256: source.sha256,
    bytes: source.bytes as number,
    purpose: source.purpose,
  })
}

function parseThemeJson(value: unknown): ThemeLayerV2 {
  const source = object(value, 'theme.json')
  exactKeys(source, ['schemaVersion', 'tokens', 'backdrop', 'partStyles'], 'theme.json')
  if (source.schemaVersion !== THEME_SCHEMA_VERSION) {
    throw new SkinArchiveError(
      'UNSUPPORTED_PROTOCOL',
      `theme.json.schemaVersion must be ${String(THEME_SCHEMA_VERSION)}`,
      'theme.json.schemaVersion',
    )
  }
  return {
    tokens: object(source.tokens, 'theme.json.tokens') as ThemeLayerV2['tokens'],
    ...(source.backdrop === undefined ? {} : { backdrop: source.backdrop as NonNullable<ThemeLayerV2['backdrop']> }),
    ...(source.partStyles === undefined ? {} : { partStyles: source.partStyles as NonNullable<ThemeLayerV2['partStyles']> }),
  }
}

function parseVisualsJson(value: unknown): SkinVisualsV1 {
  const source = object(value, VISUALS_ENTRY)
  exactKeys(source, ['schemaVersion', 'items'], VISUALS_ENTRY)
  if (source.schemaVersion !== SKIN_VISUALS_VERSION) {
    throw new SkinArchiveError(
      'UNSUPPORTED_PROTOCOL',
      `${VISUALS_ENTRY}.schemaVersion must be ${String(SKIN_VISUALS_VERSION)}`,
      `${VISUALS_ENTRY}.schemaVersion`,
    )
  }
  if (!Array.isArray(source.items) || source.items.length > MAX_VISUALS) {
    throw new TypeError(`${VISUALS_ENTRY}.items must contain at most ${String(MAX_VISUALS)} entries`)
  }
  const items = source.items.map((item, index) => parseVisualItem(item, index))
  if (new Set(items.map(item => item.id)).size !== items.length) throw new TypeError(`${VISUALS_ENTRY}.items contains duplicate ids`)
  if (new Set(items.map(item => item.slot)).size !== items.length) throw new TypeError(`${VISUALS_ENTRY}.items contains duplicate slots`)
  return Object.freeze({ schemaVersion: SKIN_VISUALS_VERSION, items: Object.freeze(items) })
}

function parseVisualItem(value: unknown, index: number): SkinVisualItem {
  const subject = `${VISUALS_ENTRY}.items[${String(index)}]`
  const source = object(value, subject)
  exactKeys(source, ['id', 'slot', 'template', 'label', 'value', 'modes'], subject)
  if (typeof source.id !== 'string' || !VISUAL_ID.test(source.id)) throw new TypeError(`${subject}.id is invalid`)
  if (typeof source.slot !== 'string' || !(VISUAL_SLOT_IDS as readonly string[]).includes(source.slot)) {
    throw new TypeError(`${subject}.slot is unsupported`)
  }
  if (typeof source.template !== 'string' || !(VISUAL_TEMPLATE_KINDS as readonly string[]).includes(source.template)) {
    throw new TypeError(`${subject}.template is unsupported`)
  }
  const slot = source.slot as VisualSlotId
  const template = source.template as VisualTemplateKind
  if (!VISUAL_TEMPLATES_BY_SLOT[slot].includes(template)) throw new TypeError(`${subject}.template is not supported by ${slot}`)
  const modes = object(source.modes, `${subject}.modes`)
  exactKeys(modes, ['light', 'dark'], `${subject}.modes`)
  if (!Object.hasOwn(modes, 'light') || !Object.hasOwn(modes, 'dark')) throw new TypeError(`${subject}.modes must contain light and dark`)
  const parsedModes = Object.freeze({
    light: parseVisualMode(modes.light, `${subject}.modes.light`),
    dark: parseVisualMode(modes.dark, `${subject}.modes.dark`),
  })
  const label = optionalString(source.label, `${subject}.label`, 40)
  const visualValue = optionalString(source.value, `${subject}.value`, 40)
  if ((template === 'image-mark' || template === 'compact-brand')
    && (parsedModes.light.assetUrl === undefined || parsedModes.dark.assetUrl === undefined)) {
    throw new TypeError(`${subject}.${template} requires Light and Dark assets`)
  }
  if ((template === 'compact-brand' || template === 'status-chip') && label === undefined) {
    throw new TypeError(`${subject}.${template} requires a label`)
  }
  return Object.freeze({
    id: source.id,
    slot,
    template,
    ...(label === undefined ? {} : { label }),
    ...(visualValue === undefined ? {} : { value: visualValue }),
    modes: parsedModes,
  })
}

function parseVisualMode(value: unknown, subject: string): SkinVisualMode {
  const source = object(value, subject)
  exactKeys(source, ['assetUrl', 'foreground', 'background', 'fit', 'positionX', 'positionY'], subject)
  if (source.fit !== undefined && source.fit !== 'cover' && source.fit !== 'contain') {
    throw new TypeError(`${subject}.fit must be cover or contain`)
  }
  for (const field of ['positionX', 'positionY'] as const) {
    const position = source[field]
    if (position !== undefined && (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1)) {
      throw new TypeError(`${subject}.${field} must be between 0 and 1`)
    }
  }
  const positionX = typeof source.positionX === 'number' ? source.positionX : undefined
  const positionY = typeof source.positionY === 'number' ? source.positionY : undefined
  return Object.freeze({
    ...(source.assetUrl === undefined ? {} : { assetUrl: `asset:${assetReference(source.assetUrl, `${subject}.assetUrl`)}` }),
    ...(source.foreground === undefined ? {} : { foreground: validateThemeColorValue(source.foreground, `${subject}.foreground`) }),
    ...(source.background === undefined ? {} : { background: validateThemeColorValue(source.background, `${subject}.background`) }),
    ...(source.fit === undefined ? {} : { fit: source.fit }),
    ...(positionX === undefined ? {} : { positionX }),
    ...(positionY === undefined ? {} : { positionY }),
  })
}

function validateAssets(assets: readonly SkinAssetManifest[], entries: Record<string, Uint8Array>): void {
  const declared = new Set(assets.map(asset => asset.path))
  const unexpected = Object.keys(entries).find(name => ASSET_PATH.test(name) && !declared.has(name))
  if (unexpected !== undefined) throw new TypeError(`skin archive asset ${JSON.stringify(unexpected)} is not declared`)
  for (const asset of assets) {
    const bytes = entries[asset.path]
    if (bytes === undefined) throw new SkinArchiveError('INVALID_ASSET', `skin archive is missing declared asset ${JSON.stringify(asset.path)}`, asset.path)
    if (bytes.byteLength !== asset.bytes) throw new SkinArchiveError('INVALID_ASSET', `skin asset ${JSON.stringify(asset.path)} byte length does not match its manifest`, asset.path)
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new SkinArchiveError('INVALID_ASSET', `skin asset ${JSON.stringify(asset.path)} hash does not match its manifest`, asset.path)
    }
    if (!matchesImageSignature(bytes, asset.mimeType)) {
      throw new SkinArchiveError('INVALID_ASSET', `skin asset ${JSON.stringify(asset.path)} does not match ${asset.mimeType}`, asset.path)
    }
  }
}

function matchesImageSignature(bytes: Uint8Array, mimeType: SkinAssetManifest['mimeType']): boolean {
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
}

function validateCapabilities(manifest: SkinManifestV4, layer: ThemeLayerV2, visuals: SkinVisualsV1 | undefined): void {
  const declared = new Set(manifest.capabilities)
  if (Object.keys(layer.tokens).length > 0 && !declared.has('tokens')) throw new TypeError('manifest.json must declare the tokens capability')
  if (layer.backdrop !== undefined && !declared.has('backdrop')) throw new TypeError('manifest.json must declare the backdrop capability')
  if ((layer.partStyles?.length ?? 0) > 0 && !declared.has('component-parts')) throw new TypeError('manifest.json must declare the component-parts capability')
  if (visuals !== undefined && !declared.has('component-visuals')) throw new TypeError('manifest.json must declare the component-visuals capability')
  if (visuals === undefined && declared.has('component-visuals')) throw new TypeError('manifest.json declares component-visuals without visuals.json')
}

function rewriteAssetReferences(
  layer: ThemeLayerV2,
  manifest: SkinManifestV4,
  fingerprint: string,
): ThemeLayerV2 {
  const assets = new Map(manifest.assets.map(asset => [asset.path, asset]))
  const referenced = new Set<string>()
  const rewrite = (mode: ThemeBackdropMode): ThemeBackdropMode => {
    if (mode.assetUrl === undefined) return mode
    const path = assetReference(mode.assetUrl, 'theme.json backdrop assetUrl')
    const asset = assets.get(path)
    if (asset === undefined) throw new TypeError(`theme.json references undeclared asset ${JSON.stringify(path)}`)
    if (asset.purpose !== 'backdrop') {
      throw new TypeError(`theme.json backdrop asset ${JSON.stringify(path)} must have purpose backdrop`)
    }
    referenced.add(path)
    return { ...mode, assetUrl: assetUrl(fingerprint, path) }
  }
  const backdrop = layer.backdrop === undefined ? undefined : {
    light: rewrite(layer.backdrop.light),
    dark: rewrite(layer.backdrop.dark),
  }
  const rewriteSurfaceImage = (image: ThemeSurfaceImage): ThemeSurfaceImage => {
    const path = assetReference(image.assetUrl, 'theme.json component surface assetUrl')
    const asset = assets.get(path)
    if (asset === undefined) throw new TypeError(`theme.json references undeclared asset ${JSON.stringify(path)}`)
    if (asset.purpose !== 'component') {
      throw new TypeError(`theme.json component surface asset ${JSON.stringify(path)} must have purpose component`)
    }
    return { ...image, assetUrl: assetUrl(fingerprint, path) }
  }
  const partStyles = layer.partStyles?.map(rule => ({
    ...rule,
    style: {
      light: rule.style.light.surfaceImage === undefined
        ? rule.style.light
        : { ...rule.style.light, surfaceImage: rewriteSurfaceImage(rule.style.light.surfaceImage) },
      dark: rule.style.dark.surfaceImage === undefined
        ? rule.style.dark
        : { ...rule.style.dark, surfaceImage: rewriteSurfaceImage(rule.style.dark.surfaceImage) },
    },
  }))
  validatePurposeReferences(manifest, referenced)
  return { ...layer, ...(backdrop === undefined ? {} : { backdrop }), ...(partStyles === undefined ? {} : { partStyles }) }
}

function rewriteVisualAssetReferences(
  visuals: SkinVisualsV1,
  manifest: SkinManifestV4,
  fingerprint: string,
): SkinVisualsV1 {
  const assets = new Map(manifest.assets.map(asset => [asset.path, asset]))
  const referenced = new Set<string>()
  const rewriteMode = (mode: SkinVisualMode, subject: string): SkinVisualMode => {
    if (mode.assetUrl === undefined) return mode
    const path = assetReference(mode.assetUrl, subject)
    const asset = assets.get(path)
    if (asset === undefined) throw new TypeError(`${VISUALS_ENTRY} references undeclared asset ${JSON.stringify(path)}`)
    if (asset.purpose !== 'visual') throw new TypeError(`${VISUALS_ENTRY} asset ${JSON.stringify(path)} must have purpose visual`)
    referenced.add(path)
    return Object.freeze({ ...mode, assetUrl: assetUrl(fingerprint, path) })
  }
  const items = visuals.items.map((item, index) => Object.freeze({
    ...item,
    modes: Object.freeze({
      light: rewriteMode(item.modes.light, `${VISUALS_ENTRY}.items[${String(index)}].modes.light.assetUrl`),
      dark: rewriteMode(item.modes.dark, `${VISUALS_ENTRY}.items[${String(index)}].modes.dark.assetUrl`),
    }),
  }))
  const unused = manifest.assets.find(asset => asset.purpose === 'visual' && !referenced.has(asset.path))
  if (unused !== undefined) throw new TypeError(`manifest.json declares unreferenced visual asset ${JSON.stringify(unused.path)}`)
  return Object.freeze({ schemaVersion: SKIN_VISUALS_VERSION, items: Object.freeze(items) })
}

function validatePurposeReferences(manifest: SkinManifestV4, backdropReferences: ReadonlySet<string>): void {
  const previewReferences = manifest.preview === undefined
    ? new Set<string>()
    : new Set([
        assetReference(manifest.preview.light, 'manifest.json.preview.light'),
        assetReference(manifest.preview.dark, 'manifest.json.preview.dark'),
      ])
  for (const asset of manifest.assets) {
    if (asset.purpose === 'backdrop' && !backdropReferences.has(asset.path)) {
      throw new TypeError(`manifest.json declares unreferenced backdrop asset ${JSON.stringify(asset.path)}`)
    }
    if (asset.purpose === 'preview' && !previewReferences.has(asset.path)) {
      throw new TypeError(`manifest.json declares unreferenced preview asset ${JSON.stringify(asset.path)}`)
    }
  }
  for (const path of previewReferences) {
    const asset = manifest.assets.find(candidate => candidate.path === path)
    if (asset === undefined) throw new TypeError(`manifest.json.preview references undeclared asset ${JSON.stringify(path)}`)
    if (asset.purpose !== 'preview' && asset.purpose !== 'backdrop') {
      throw new TypeError(`manifest.json.preview asset ${JSON.stringify(path)} must have purpose preview or backdrop`)
    }
  }
}

function presentationFields(
  manifest: SkinManifestV4,
  fingerprint: string,
): { preview?: SkinPreviewUrls } {
  const preview = manifest.preview === undefined ? undefined : Object.freeze({
    light: assetUrl(fingerprint, assetReference(manifest.preview.light, 'manifest.json.preview.light')),
    dark: assetUrl(fingerprint, assetReference(manifest.preview.dark, 'manifest.json.preview.dark')),
  })
  return preview === undefined ? {} : { preview }
}

function assetReference(value: unknown, subject: string): string {
  if (typeof value !== 'string' || !value.startsWith('asset:')) throw new TypeError(`${subject} must use an asset: reference`)
  const path = value.slice('asset:'.length)
  if (!ASSET_PATH.test(path)) throw new TypeError(`${subject} contains an unsafe asset path`)
  return path
}

function assetUrl(fingerprint: string, path: string): string {
  return `/api/dsh-skin/assets/${fingerprint}/${path.slice('assets/'.length)}`
}

function fingerprintEntries(entries: Record<string, Uint8Array>): string {
  const hash = createHash('sha256')
  for (const name of Object.keys(entries).sort()) {
    hash.update(name)
    hash.update('\0')
    hash.update(entries[name] as Uint8Array)
    hash.update('\0')
  }
  return hash.digest('hex')
}
