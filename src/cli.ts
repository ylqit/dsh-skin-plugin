#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { compileExperience } from './author/compiler.ts'
import type {
  SkinAssetManifest, SkinManifestV2, SkinPlacement, ThemeLayerDefinition,
} from './shared/contracts.ts'
import { SKIN_PLACEMENTS, SKIN_SCHEMA_VERSION_V2, THEME_PARTS_VERSION } from './shared/contracts.ts'

interface AuthorConfig {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  tags?: readonly string[]
  preview: { light: string; dark: string }
  placements?: readonly SkinPlacement[]
}

const TEMPLATE_ROOT = fileURLToPath(new URL('../templates/experience-skin', import.meta.url))

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const [command, target, output] = argv
  if (command === 'create' && target !== undefined && output === undefined) {
    await createTheme(target)
    return
  }
  if (command === 'pack' && target !== undefined) {
    await packTheme(resolve(target), output === undefined ? undefined : resolve(output))
    return
  }
  throw new TypeError('用法: dsh-skin create <theme-id> | dsh-skin pack <theme-directory> [output.dshskin]')
}

async function createTheme(id: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(id)) throw new TypeError('theme-id 只能使用 2-63 位小写字母、数字与连字符')
  const target = resolve(process.cwd(), id)
  await cp(TEMPLATE_ROOT, target, { recursive: true, errorOnExist: true, force: false })
  await mkdir(resolve(target, 'assets'))
  for (const relative of ['skin.config.json', 'README.md']) {
    const filename = resolve(target, relative)
    const source = await readFile(filename, 'utf8')
    await writeFile(filename, source.replaceAll('__THEME_ID__', id).replaceAll('__THEME_NAME__', titleCase(id)))
  }
  console.log(`已创建主题模板: ${target}`)
}

async function packTheme(root: string, requestedOutput?: string): Promise<void> {
  const config = parseAuthorConfig(await readJson(resolve(root, 'skin.config.json')))
  const themeBytes = new Uint8Array(await readFile(resolve(root, 'theme.json')))
  const theme = parseThemeShape(JSON.parse(new TextDecoder().decode(themeBytes)) as unknown)
  const files: Record<string, Uint8Array> = { 'theme.json': themeBytes }
  const assetNames = (await readdir(resolve(root, 'assets'), { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort()
  if (assetNames.length === 0) throw new TypeError('主题至少需要一张预览或背景图片')

  const backdropPaths = new Set([
    assetPath(theme.backdrop?.light.assetUrl),
    assetPath(theme.backdrop?.dark.assetUrl),
  ].filter((value): value is string => value !== undefined))
  const previewPaths = new Set([normalizeAssetPath(config.preview.light), normalizeAssetPath(config.preview.dark)])
  const assets: SkinAssetManifest[] = []
  for (const name of assetNames) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(name)) throw new TypeError(`不安全的资源文件名: ${name}`)
    const path = `assets/${name}`
    const bytes = new Uint8Array(await readFile(resolve(root, 'assets', name)))
    files[path] = bytes
    assets.push({
      path,
      mimeType: imageMime(name),
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      purpose: backdropPaths.has(path) ? 'backdrop' : previewPaths.has(path) ? 'preview' : 'component',
    })
  }

  const placements = Object.freeze([...(config.placements ?? [])])
  let experience: SkinManifestV2['experience']
  try {
    await readFile(resolve(root, 'experience', 'client.tsx'))
    if (placements.length === 0) throw new TypeError('skin.config.json 必须为 Experience 声明至少一个 placement')
    const moduleId = `dsh-skin:${randomUUID()}`
    const bytes = await compileExperience(root, moduleId)
    files['experience/client.js'] = bytes
    experience = {
      apiVersion: 1,
      moduleId,
      entry: 'experience/client.js',
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      placements,
    }
  } catch (error) {
    if (!isMissing(error)) throw error
    if (placements.length > 0) throw new TypeError('声明了 placements，但缺少 experience/client.tsx')
  }

  const capabilities: SkinManifestV2['capabilities'] = Object.freeze([
    ...(Object.keys(theme.tokens).length === 0 ? [] : ['tokens' as const]),
    ...(theme.backdrop === undefined ? [] : ['backdrop' as const]),
    ...((theme.partStyles?.length ?? 0) === 0 ? [] : ['component-parts' as const]),
    ...(experience === undefined ? [] : ['component-experience' as const]),
  ])
  const manifest: SkinManifestV2 = {
    schemaVersion: SKIN_SCHEMA_VERSION_V2,
    id: config.id,
    name: config.name,
    version: config.version,
    ...(config.author === undefined ? {} : { author: config.author }),
    ...(config.description === undefined ? {} : { description: config.description }),
    ...(config.tags === undefined ? {} : { tags: config.tags }),
    themePartsVersion: THEME_PARTS_VERSION,
    capabilities,
    preview: {
      light: `asset:${normalizeAssetPath(config.preview.light)}`,
      dark: `asset:${normalizeAssetPath(config.preview.dark)}`,
    },
    assets,
    ...(experience === undefined ? {} : { experience }),
  }
  files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
  validatePackedFiles(manifest, theme, files)
  const fingerprint = contentFingerprint(files)
  const zip: Zippable = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes]))
  const output = requestedOutput ?? resolve(root, 'dist', `${config.id}-${config.version}.dshskin`)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, zipSync(zip, { level: 6 }), { flag: 'wx' })
  console.log(`已输出 ${output}`)
  console.log(`内容指纹 ${fingerprint}`)
}

function parseAuthorConfig(value: unknown): AuthorConfig {
  const source = record(value, 'skin.config.json')
  const allowed = new Set(['id', 'name', 'version', 'author', 'description', 'tags', 'preview', 'placements'])
  const unknown = Object.keys(source).find(key => !allowed.has(key))
  if (unknown !== undefined) throw new TypeError(`skin.config.json 含未知字段 ${JSON.stringify(unknown)}`)
  const id = requiredString(source.id, 'id', 80)
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(id)) throw new TypeError('skin.config.json.id 格式无效')
  const name = requiredString(source.name, 'name', 120)
  const version = requiredString(source.version, 'version', 40)
  const preview = record(source.preview, 'preview')
  exactKeys(preview, ['light', 'dark'], 'preview')
  const placements = source.placements === undefined ? undefined : stringArray(source.placements, 'placements')
  if (placements?.some(value => !SKIN_PLACEMENTS.includes(value as SkinPlacement)) === true) {
    throw new TypeError('skin.config.json.placements 含未知主题 Slot')
  }
  const tags = source.tags === undefined ? undefined : stringArray(source.tags, 'tags')
  return {
    id,
    name,
    version,
    ...(source.author === undefined ? {} : { author: requiredString(source.author, 'author', 120) }),
    ...(source.description === undefined ? {} : { description: requiredString(source.description, 'description', 500) }),
    ...(tags === undefined ? {} : { tags }),
    preview: {
      light: requiredString(preview.light, 'preview.light', 160),
      dark: requiredString(preview.dark, 'preview.dark', 160),
    },
    ...(placements === undefined ? {} : { placements: placements as SkinPlacement[] }),
  }
}

function parseThemeShape(value: unknown): ThemeLayerDefinition & { schemaVersion: number } {
  const source = record(value, 'theme.json')
  return source as unknown as ThemeLayerDefinition & { schemaVersion: number }
}

function record(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${subject} 必须为对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], subject: string): void {
  const unknown = Object.keys(value).find(key => !keys.includes(key))
  if (unknown !== undefined) throw new TypeError(`${subject} 含未知字段 ${JSON.stringify(unknown)}`)
}

function requiredString(value: unknown, subject: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new TypeError(`${subject} 必须为非空字符串且不超过 ${String(max)} 字符`)
  return value
}

function stringArray(value: unknown, subject: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError(`${subject} 必须为字符串数组`)
  if (new Set(value).size !== value.length) throw new TypeError(`${subject} 不允许重复值`)
  return value as string[]
}

function normalizeAssetPath(value: string): string {
  const path = value.startsWith('asset:') ? value.slice('asset:'.length) : value
  if (!/^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(path)) throw new TypeError(`资源引用不安全: ${value}`)
  return path
}

function assetPath(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeAssetPath(value)
}

function imageMime(filename: string): SkinAssetManifest['mimeType'] {
  const extension = extname(filename).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  throw new TypeError(`不支持的图片类型: ${basename(filename)}`)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function validatePackedFiles(
  manifest: SkinManifestV2,
  theme: ThemeLayerDefinition & { schemaVersion: number },
  files: Readonly<Record<string, Uint8Array>>,
): void {
  if (theme.schemaVersion !== 1) throw new TypeError('theme.json.schemaVersion 必须为 1')
  for (const asset of manifest.assets) {
    const bytes = files[asset.path]
    if (bytes === undefined || bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256) {
      throw new TypeError(`资源清单与文件不一致: ${asset.path}`)
    }
    if (!matchesImageSignature(bytes, asset.mimeType)) throw new TypeError(`图片签名与 MIME 不符: ${asset.path}`)
  }
  for (const value of [manifest.preview.light, manifest.preview.dark]) {
    const path = normalizeAssetPath(value)
    if (!manifest.assets.some(asset => asset.path === path)) throw new TypeError(`预览资源未登记: ${path}`)
  }
  if (manifest.experience !== undefined) {
    const bytes = files[manifest.experience.entry]
    if (bytes === undefined || bytes.byteLength !== manifest.experience.bytes || sha256(bytes) !== manifest.experience.sha256) {
      throw new TypeError('Experience Bundle 清单与文件不一致')
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!source.includes('window.__ModuleLoader__.load') || !source.includes(JSON.stringify(manifest.experience.moduleId))) {
      throw new TypeError('Experience Bundle 模块 ID 与 manifest 不一致')
    }
  }
}

function matchesImageSignature(bytes: Uint8Array, mimeType: SkinAssetManifest['mimeType']): boolean {
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
}

function contentFingerprint(files: Readonly<Record<string, Uint8Array>>): string {
  const hash = createHash('sha256')
  for (const name of Object.keys(files).sort()) hash.update(name).update('\0').update(files[name] as Uint8Array).update('\0')
  return hash.digest('hex')
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8')) as unknown
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function titleCase(id: string): string {
  return id.split('-').map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
