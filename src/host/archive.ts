import { createHash } from 'node:crypto'
import { unzipSync, type UnzipFileInfo } from 'fflate'
import { THEME_PARTS_VERSION as HARNESS_THEME_PARTS_VERSION, validateThemeLayer } from '@deepseek-ai/dsh-client-ui-theme'
import {
  SKIN_CAPABILITIES, SKIN_SCHEMA_VERSION, THEME_PARTS_VERSION,
  type SkinAssetManifest, type SkinManifest, type ThemeBackdropMode, type ThemeLayerDefinition,
} from '../shared/contracts.ts'

export const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024
const MAX_EXPANDED_BYTES = 48 * 1024 * 1024
const MAX_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_ENTRIES = 32
const MAX_COMPRESSION_RATIO = 200
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true })
const ASSET_PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const HASH = /^[a-f0-9]{64}$/

export interface ParsedSkinArchive {
  fingerprint: string
  manifest: SkinManifest
  layer: ThemeLayerDefinition
  files: ReadonlyMap<string, Uint8Array>
}

/** Parse and authenticate one inert .dshskin ZIP before anything reaches disk. */
export function parseSkinArchive(archive: Uint8Array): ParsedSkinArchive {
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
  return parseSkinFiles(entries, count)
}

/** Revalidate the persisted immutable file set during Host startup. */
export function parseSkinFiles(entries: Record<string, Uint8Array>, archiveEntryCount = Object.keys(entries).length): ParsedSkinArchive {
  const names = Object.keys(entries).sort()
  if (names.length !== archiveEntryCount) throw new TypeError('skin archive contains duplicate entry names')
  if (!names.includes('manifest.json') || !names.includes('theme.json')) {
    throw new TypeError('skin archive must contain manifest.json and theme.json')
  }
  const unsupported = names.find(name => name !== 'manifest.json' && name !== 'theme.json' && !ASSET_PATH.test(name))
  if (unsupported !== undefined) throw new TypeError(`skin archive contains unsupported entry ${JSON.stringify(unsupported)}`)

  const manifest = parseManifest(parseJson(entries['manifest.json'], 'manifest.json'))
  const themeSource = parseThemeJson(parseJson(entries['theme.json'], 'theme.json'))
  validateAssets(manifest.assets, entries)
  validateCapabilities(manifest, themeSource)
  const fingerprint = fingerprintEntries(entries)
  const layer = rewriteAssetReferences(themeSource, fingerprint, new Set(manifest.assets.map(asset => asset.path)))
  return Object.freeze({ fingerprint, manifest, layer: validateThemeLayer(layer), files: readonlyFiles(entries) })
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

function parseManifest(value: unknown): SkinManifest {
  const source = object(value, 'manifest.json')
  exactKeys(source, ['schemaVersion', 'id', 'name', 'version', 'themePartsVersion', 'capabilities', 'assets'], 'manifest.json')
  if (source.schemaVersion !== SKIN_SCHEMA_VERSION) throw new TypeError(`manifest.json.schemaVersion must be ${String(SKIN_SCHEMA_VERSION)}`)
  if (source.themePartsVersion !== THEME_PARTS_VERSION || source.themePartsVersion !== HARNESS_THEME_PARTS_VERSION) {
    throw new TypeError(`manifest.json.themePartsVersion must be ${String(THEME_PARTS_VERSION)}`)
  }
  if (!Array.isArray(source.capabilities)) throw new TypeError('manifest.json.capabilities must be an array')
  const capabilities = source.capabilities.map((capability) => {
    if (typeof capability !== 'string' || !(SKIN_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new TypeError(`manifest.json contains unsupported capability ${JSON.stringify(capability)}`)
    }
    return capability as (typeof SKIN_CAPABILITIES)[number]
  })
  if (new Set(capabilities).size !== capabilities.length) throw new TypeError('manifest.json.capabilities contains duplicates')
  if (!Array.isArray(source.assets) || source.assets.length > 8) throw new TypeError('manifest.json.assets must contain at most eight entries')
  const assets = source.assets.map((asset, index) => parseAsset(asset, index))
  if (new Set(assets.map(asset => asset.path)).size !== assets.length) throw new TypeError('manifest.json.assets contains duplicate paths')
  return Object.freeze({
    schemaVersion: SKIN_SCHEMA_VERSION,
    id: requiredString(source.id, 'manifest.json.id', 80),
    name: requiredString(source.name, 'manifest.json.name', 120),
    version: requiredString(source.version, 'manifest.json.version', 40),
    themePartsVersion: THEME_PARTS_VERSION,
    capabilities: Object.freeze(capabilities),
    assets: Object.freeze(assets),
  })
}

function parseAsset(value: unknown, index: number): SkinAssetManifest {
  const subject = `manifest.json.assets[${String(index)}]`
  const source = object(value, subject)
  exactKeys(source, ['path', 'mimeType', 'sha256', 'bytes'], subject)
  if (typeof source.path !== 'string' || !ASSET_PATH.test(source.path)) throw new TypeError(`${subject}.path is unsafe`)
  if (source.mimeType !== 'image/jpeg' && source.mimeType !== 'image/png' && source.mimeType !== 'image/webp') {
    throw new TypeError(`${subject}.mimeType is unsupported`)
  }
  if (typeof source.sha256 !== 'string' || !HASH.test(source.sha256)) throw new TypeError(`${subject}.sha256 must be lowercase SHA-256`)
  if (!Number.isSafeInteger(source.bytes) || (source.bytes as number) < 1 || (source.bytes as number) > MAX_ENTRY_BYTES) {
    throw new TypeError(`${subject}.bytes is outside the accepted range`)
  }
  return Object.freeze({
    path: source.path,
    mimeType: source.mimeType,
    sha256: source.sha256,
    bytes: source.bytes as number,
  })
}

function parseThemeJson(value: unknown): ThemeLayerDefinition {
  const source = object(value, 'theme.json')
  exactKeys(source, ['schemaVersion', 'tokens', 'backdrop', 'partStyles'], 'theme.json')
  if (source.schemaVersion !== SKIN_SCHEMA_VERSION) throw new TypeError(`theme.json.schemaVersion must be ${String(SKIN_SCHEMA_VERSION)}`)
  return {
    tokens: object(source.tokens, 'theme.json.tokens') as ThemeLayerDefinition['tokens'],
    ...(source.backdrop === undefined ? {} : { backdrop: source.backdrop as NonNullable<ThemeLayerDefinition['backdrop']> }),
    ...(source.partStyles === undefined ? {} : { partStyles: source.partStyles as NonNullable<ThemeLayerDefinition['partStyles']> }),
  }
}

function validateAssets(assets: readonly SkinAssetManifest[], entries: Record<string, Uint8Array>): void {
  const declared = new Set(assets.map(asset => asset.path))
  const unexpected = Object.keys(entries).find(name => ASSET_PATH.test(name) && !declared.has(name))
  if (unexpected !== undefined) throw new TypeError(`skin archive asset ${JSON.stringify(unexpected)} is not declared`)
  for (const asset of assets) {
    const bytes = entries[asset.path]
    if (bytes === undefined) throw new TypeError(`skin archive is missing declared asset ${JSON.stringify(asset.path)}`)
    if (bytes.byteLength !== asset.bytes) throw new TypeError(`skin asset ${JSON.stringify(asset.path)} byte length does not match its manifest`)
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new TypeError(`skin asset ${JSON.stringify(asset.path)} hash does not match its manifest`)
    if (!matchesImageSignature(bytes, asset.mimeType)) throw new TypeError(`skin asset ${JSON.stringify(asset.path)} does not match ${asset.mimeType}`)
  }
}

function matchesImageSignature(bytes: Uint8Array, mimeType: SkinAssetManifest['mimeType']): boolean {
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
}

function validateCapabilities(manifest: SkinManifest, layer: ThemeLayerDefinition): void {
  const declared = new Set(manifest.capabilities)
  if (Object.keys(layer.tokens).length > 0 && !declared.has('tokens')) throw new TypeError('manifest.json must declare the tokens capability')
  if (layer.backdrop !== undefined && !declared.has('backdrop')) throw new TypeError('manifest.json must declare the backdrop capability')
  if ((layer.partStyles?.length ?? 0) > 0 && !declared.has('component-parts')) throw new TypeError('manifest.json must declare the component-parts capability')
}

function rewriteAssetReferences(layer: ThemeLayerDefinition, fingerprint: string, assets: ReadonlySet<string>): ThemeLayerDefinition {
  if (layer.backdrop === undefined) {
    if (assets.size > 0) throw new TypeError('manifest.json declares assets that theme.json does not reference')
    return layer
  }
  const referenced = new Set<string>()
  const rewrite = (mode: ThemeBackdropMode): ThemeBackdropMode => {
    if (mode.assetUrl === undefined) return mode
    if (!mode.assetUrl.startsWith('asset:')) throw new TypeError('persisted theme backdrop assets must use asset: references')
    const path = mode.assetUrl.slice('asset:'.length)
    if (!assets.has(path)) throw new TypeError(`theme.json references undeclared asset ${JSON.stringify(path)}`)
    referenced.add(path)
    return { ...mode, assetUrl: `/api/dsh-skin/assets/${fingerprint}/${path.slice('assets/'.length)}` }
  }
  const backdrop = { light: rewrite(layer.backdrop.light), dark: rewrite(layer.backdrop.dark) }
  const unused = [...assets].find(path => !referenced.has(path))
  if (unused !== undefined) throw new TypeError(`manifest.json declares unreferenced asset ${JSON.stringify(unused)}`)
  return { ...layer, backdrop }
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
