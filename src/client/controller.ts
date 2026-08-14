import { strToU8, zipSync, type Zippable } from 'fflate'
import { flushSync } from 'react-dom'
import type {
  CommitSkinResult, PrepareSkinResult, SkinAssetManifest, SkinExperienceDescriptor,
  SkinHostState, SkinManifest, SkinPlacement, ThemeBackdropMode, ThemeColorValue,
  ThemeLayerDefinition, ThemePartRule, ThemePartStyle,
} from '../shared/contracts.ts'
import {
  SKIN_PLACEMENTS, SKIN_SCHEMA_VERSION, SKIN_SCHEMA_VERSION_V2, THEME_PARTS_VERSION,
} from '../shared/contracts.ts'
import type {
  ClientModuleLoader, HostObservable, LoadedExperience, SkinExperienceModule,
  SkinExperienceSnapshot, StudioSnapshot, ThemeService,
} from './contracts.ts'

const API = '/api/dsh-skin'
const PREVIEW_SOURCE = '@deepseek-ai/dsh-skin-plugin/preview'
const EMPTY_BACKDROP: ThemeBackdropMode = {
  fallbackColor: '#f5f7fb', focusX: 0.5, focusY: 0.5, dim: 0.12, blurPx: 0,
}

interface DraftAsset {
  bytes: Uint8Array
  mimeType: SkinAssetManifest['mimeType']
  path: string
  objectUrl: string
}

interface PresentationLane {
  key: string
  themeId: string
  disposeTheme?: () => void
  experience?: LoadedExperience
}

/** Browser controller: one complete draft per update and one active/preview installation per lane. */
export class SkinStudioController {
  private readonly listeners = new Set<() => void>()
  private snapshotValue: StudioSnapshot
  readonly experience: HostObservable<SkinExperienceSnapshot | undefined>
  private readonly experienceState: ExperienceObservable
  private activeLane: PresentationLane | undefined
  private previewLane: PresentationLane | undefined
  private eventSource: EventSource | undefined
  private assets: DraftAsset[] = []
  private mode: 'light' | 'dark'
  private busyCount = 0
  private refreshGeneration = 0

  constructor(
    private readonly theme: ThemeService,
    private readonly modules: ClientModuleLoader,
    localManagement: boolean,
  ) {
    this.mode = theme.getTheme().active.colorScheme
    this.experienceState = new ExperienceObservable()
    this.experience = this.experienceState
    this.snapshotValue = {
      host: undefined,
      draft: starterLayer(),
      draftName: '我的 Harness 皮肤',
      busy: false,
      previewing: false,
      localManagement,
      error: undefined,
      tokens: Object.freeze(theme.exportInspectTokens()),
      parts: Object.freeze(theme.exportInspectParts()),
    }
  }

  getSnapshot = (): StudioSnapshot => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Start initial state loading plus cross-client invalidation. */
  start(): () => void {
    void this.refresh()
    if (typeof EventSource !== 'undefined') {
      this.eventSource = new EventSource(`${API}/events`)
      this.eventSource.addEventListener('skin-change', () => { void this.refresh() })
    }
    return () => {
      this.eventSource?.close()
      this.eventSource = undefined
      this.releaseLane(this.previewLane)
      this.previewLane = undefined
      this.releaseLane(this.activeLane)
      this.activeLane = undefined
      this.experienceState.publish(undefined)
      this.revokeAssets()
    }
  }

  beginDraft(fingerprint?: string): void {
    void this.run(async () => {
      let layer: ThemeLayerDefinition
      const summary = fingerprint === undefined
        ? undefined
        : this.snapshotValue.host?.skins.find(skin => skin.fingerprint === fingerprint)
      if (fingerprint === undefined) {
        layer = starterLayer()
      } else if (fingerprint === this.snapshotValue.host?.activeFingerprint && this.snapshotValue.host.activeLayer !== undefined) {
        layer = this.snapshotValue.host.activeLayer
      } else {
        layer = (await request<{ fingerprint: string; layer: ThemeLayerDefinition }>(`${API}/skins/${fingerprint}`)).layer
      }
      const draft = structuredClone(layer)
      const assets = await this.loadManagedAssets(draft)
      const name = fingerprint === undefined
        ? '我的 Harness 皮肤'
        : summary?.name ?? '我的 Harness 皮肤'
      const experience = await this.loadExperience(summary?.experience)
      this.publishDraft(draft, name, assets, experience)
    })
  }

  updateDraftName(name: string): void {
    this.set({ draftName: name.slice(0, 120) })
  }

  updateToken(name: string, mode: 'light' | 'dark', value: string): void {
    const layer = structuredClone(this.snapshotValue.draft)
    const current = layer.tokens[name] ?? { light: '#ffffff', dark: '#111827' }
    layer.tokens[name] = { ...current, [mode]: value }
    this.publishDraft(layer)
  }

  updateBackdrop(
    mode: 'light' | 'dark',
    field: 'fallbackColor' | 'focusX' | 'focusY' | 'dim' | 'blurPx',
    value: string,
  ): void {
    const layer = structuredClone(this.snapshotValue.draft)
    const backdrop = layer.backdrop ?? { light: { ...EMPTY_BACKDROP }, dark: { ...EMPTY_BACKDROP, fallbackColor: '#0b1020' } }
    const parsed = field === 'fallbackColor' ? colorValue(value) : Number(value)
    layer.backdrop = { ...backdrop, [mode]: { ...backdrop[mode], [field]: parsed } }
    this.publishDraft(layer)
  }

  updateBackdropImage(mode: 'light' | 'dark', file: File): void {
    void this.run(async () => {
      if (file.size === 0 || file.size > 16 * 1024 * 1024) throw new TypeError('背景图片必须小于 16 MiB')
      const mimeType = imageMime(file.type)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
      try {
        await decodeImage(objectUrl)
      } catch (error) {
        URL.revokeObjectURL(objectUrl)
        throw error
      }
      const layer = structuredClone(this.snapshotValue.draft)
      const backdrop = layer.backdrop ?? { light: { ...EMPTY_BACKDROP }, dark: { ...EMPTY_BACKDROP, fallbackColor: '#0b1020' } }
      layer.backdrop = {
        ...backdrop,
        [mode]: { ...backdrop[mode], assetUrl: objectUrl },
      }
      const referenced = new Set([layer.backdrop.light.assetUrl, layer.backdrop.dark.assetUrl])
      const assets = [
        ...this.assets.filter(asset => referenced.has(asset.objectUrl)),
        { bytes, mimeType, path: `assets/backdrop-${mode}.${extension(mimeType)}`, objectUrl },
      ]
      this.publishDraft(layer, this.snapshotValue.draftName, assets)
    })
  }

  upsertPartRule(part: string, variant: string, state: string, field: string, light: string, dark: string): void {
    try {
      const layer = structuredClone(this.snapshotValue.draft)
      const rules = [...(layer.partStyles ?? [])]
      const normalizedVariant = variant === '' ? undefined : variant
      const normalizedState = state === '' ? undefined : state
      const at = rules.findIndex(rule => rule.part === part && rule.variant === normalizedVariant && rule.state === normalizedState)
      const previous = at < 0 ? undefined : rules[at]
      const lightStyle = { ...(previous?.style.light ?? {}), [field]: partValue(field, light) }
      const darkStyle = { ...(previous?.style.dark ?? {}), [field]: partValue(field, dark) }
      const rule = {
        part,
        ...(normalizedVariant === undefined ? {} : { variant: normalizedVariant }),
        ...(normalizedState === undefined ? {} : { state: normalizedState }),
        style: { light: lightStyle, dark: darkStyle },
      } as ThemePartRule
      if (at < 0) rules.push(rule)
      else rules[at] = rule
      layer.partStyles = rules
      this.publishDraft(layer)
    } catch (error) {
      this.fail(error)
    }
  }

  importSkin(file: File): void {
    void this.run(async () => {
      this.assertLocal()
      await uploadArchive(new Uint8Array(await file.arrayBuffer()))
      await this.refresh()
    })
  }

  saveDraft(): void {
    void this.run(async () => {
      this.assertLocal()
      await uploadArchive(await this.buildArchive())
      await this.refresh()
    })
  }

  exportDraft(): void {
    void this.run(async () => {
      this.assertLocal()
      const bytes = await this.buildArchive()
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeFilename(this.snapshotValue.draftName)}.dshskin`
      anchor.click()
      queueMicrotask(() => { URL.revokeObjectURL(url) })
    })
  }

  activate(fingerprint: string): void {
    void this.run(async () => {
      this.assertLocal()
      const prepared = await request<PrepareSkinResult>(`${API}/prepare`, { method: 'POST', body: JSON.stringify({ fingerprint }) })
      if (prepared.layer === undefined || prepared.fingerprint === undefined) throw new Error('Host returned an incomplete skin preparation')
      await this.installPreparedPreview(prepared)
      let committed: CommitSkinResult
      try {
        committed = await request<CommitSkinResult>(`${API}/commit`, {
          method: 'POST', body: JSON.stringify({ preparationId: prepared.preparationId }),
        })
      } catch (error) {
        const host = await request<SkinHostState>(`${API}/state`).catch(() => undefined)
        if (
          host?.activeFingerprint === prepared.fingerprint
          && host.activeLayer !== undefined
          && host.activationRevision > prepared.activationRevision
        ) {
          this.set({ host, error: undefined })
          await this.installActive({
            fingerprint: host.activeFingerprint,
            layer: host.activeLayer,
            activationRevision: host.activationRevision,
            ...(host.activeExperience === undefined ? {} : { experience: host.activeExperience }),
          })
          return
        }
        await request(`${API}/cancel`, { method: 'POST', body: JSON.stringify({ preparationId: prepared.preparationId }) }).catch(() => undefined)
        throw error
      }
      await this.installActive(committed)
      await this.refresh()
    })
  }

  restoreDefault(): void {
    void this.run(async () => {
      this.assertLocal()
      const prepared = await request<PrepareSkinResult>(`${API}/prepare`, { method: 'POST', body: '{}' })
      const committed = await request<CommitSkinResult>(`${API}/commit`, {
        method: 'POST', body: JSON.stringify({ preparationId: prepared.preparationId }),
      })
      await this.installActive(committed)
      await this.refresh()
    })
  }

  cancelPreview(): void {
    const previous = this.previewLane
    if (previous === undefined) return
    flushSync(() => {
      previous.disposeTheme?.()
      this.previewLane = undefined
      this.publishExperience()
      this.set({ previewing: false, error: undefined })
    })
    previous.experience?.handle.release()
  }

  setColorScheme(mode: 'light' | 'dark'): void {
    this.theme.setTheme(mode)
  }

  /** Mirror ThemeRuntime's resolved mode into capability-free experience props. */
  setResolvedMode(mode: 'light' | 'dark'): void {
    if (this.mode === mode) return
    this.mode = mode
    this.publishExperience()
  }

  deleteSkin(fingerprint: string): void {
    void this.run(async () => {
      this.assertLocal()
      await request(`${API}/skins/${fingerprint}`, { method: 'DELETE' })
      await this.refresh()
    })
  }

  private async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration
    try {
      const host = await request<SkinHostState>(`${API}/state`)
      if (generation !== this.refreshGeneration) return
      this.set({ host, error: undefined })
      await this.installActive({
        ...(host.activeFingerprint === undefined ? {} : { fingerprint: host.activeFingerprint }),
        ...(host.activeLayer === undefined ? {} : { layer: host.activeLayer }),
        ...(host.activeExperience === undefined ? {} : { experience: host.activeExperience }),
        activationRevision: host.activationRevision,
      })
    } catch (error) {
      if (generation === this.refreshGeneration) this.fail(error)
    }
  }

  private async installActive(committed: CommitSkinResult): Promise<void> {
    const key = committed.layer === undefined || committed.fingerprint === undefined
      ? `default:${String(committed.activationRevision)}`
      : `${committed.fingerprint}:${String(committed.activationRevision)}`
    if (this.activeLane?.key === key && this.previewLane === undefined) return

    let experience: LoadedExperience | undefined
    const canPromote = committed.experience !== undefined
      && this.previewLane?.experience?.descriptor.moduleId === committed.experience.moduleId
      && this.previewLane.experience.descriptor.rev === committed.experience.rev
    if (canPromote) {
      experience = this.previewLane?.experience
      if (this.previewLane !== undefined) delete this.previewLane.experience
    } else {
      experience = await this.loadExperience(committed.experience)
    }
    if (committed.layer !== undefined) await preloadLayerImages(committed.layer)

    const oldActive = this.activeLane
    const oldPreview = this.previewLane
    let next: PresentationLane
    try {
      flushSync(() => {
        const disposeTheme = committed.layer === undefined || committed.fingerprint === undefined
          ? undefined
          : this.theme.installSkin(committed.fingerprint, committed.layer, {
              kind: 'active',
              contentFingerprint: committed.fingerprint,
              activationRevision: committed.activationRevision,
            })
        oldPreview?.disposeTheme?.()
        next = {
          key,
          themeId: committed.fingerprint ?? 'harness-default',
          ...(disposeTheme === undefined ? {} : { disposeTheme }),
          ...(experience === undefined ? {} : { experience }),
        }
        this.activeLane = next
        this.previewLane = undefined
        this.publishExperience()
        this.set({ previewing: false, error: undefined })
      })
    } catch (error) {
      if (canPromote && oldPreview !== undefined && experience !== undefined) oldPreview.experience = experience
      else experience?.handle.release()
      throw error
    }
    this.releaseLane(oldActive)
    if (oldPreview !== undefined) this.releaseLane(oldPreview)
  }

  private async installPreparedPreview(prepared: PrepareSkinResult): Promise<void> {
    if (prepared.layer === undefined || prepared.fingerprint === undefined) {
      throw new Error('Host returned an incomplete skin preparation')
    }
    const experience = await this.loadExperience(prepared.experience)
    try {
      await preloadLayerImages(prepared.layer)
      this.replacePreview(prepared.layer, prepared.fingerprint, experience)
    } catch (error) {
      experience?.handle.release()
      throw error
    }
  }

  private replacePreview(
    layer: ThemeLayerDefinition,
    themeId: string,
    experience?: LoadedExperience,
  ): void {
    const previous = this.previewLane
    if (previous !== undefined && previous.experience === experience) delete previous.experience
    let next: PresentationLane
    try {
      flushSync(() => {
        const disposeTheme = this.theme.installSkin(PREVIEW_SOURCE, layer, {
          kind: 'preview',
          ...(themeId === PREVIEW_SOURCE ? {} : { contentFingerprint: themeId }),
        })
        next = {
          key: `preview:${themeId}`,
          themeId,
          disposeTheme,
          ...(experience === undefined ? {} : { experience }),
        }
        this.previewLane = next
        this.publishExperience()
        this.set({ previewing: true, error: undefined })
      })
    } catch (error) {
      experience?.handle.release()
      throw error
    }
    this.releaseLane(previous)
  }

  private publishDraft(
    layer: ThemeLayerDefinition,
    draftName = this.snapshotValue.draftName,
    replacementAssets?: DraftAsset[],
    experience = this.previewLane?.experience,
  ): void {
    this.set({ draft: layer, draftName })
    try {
      this.replacePreview(layer, PREVIEW_SOURCE, experience)
      if (replacementAssets !== undefined) this.replaceAssets(replacementAssets)
    } catch (error) {
      if (replacementAssets !== undefined) {
        const existing = new Set(this.assets)
        for (const asset of replacementAssets) {
          if (!existing.has(asset)) URL.revokeObjectURL(asset.objectUrl)
        }
      }
      this.fail(error)
    }
  }

  private async loadExperience(descriptor: SkinExperienceDescriptor | undefined): Promise<LoadedExperience | undefined> {
    if (descriptor === undefined) return undefined
    const handle = await this.modules.loadDynamic({
      id: descriptor.moduleId,
      url: descriptor.url,
      rev: descriptor.rev,
    })
    try {
      const module = validateExperienceModule(handle.exports, descriptor)
      await Promise.all(Object.values(descriptor.assets).map(preloadImage))
      return { descriptor, module, handle }
    } catch (error) {
      handle.release()
      throw error
    }
  }

  private publishExperience(): void {
    const lane = this.previewLane ?? this.activeLane
    const loaded = lane?.experience
    this.experienceState.publish(lane === undefined || loaded === undefined ? undefined : Object.freeze({
      themeId: lane.themeId,
      mode: this.mode,
      assets: loaded.descriptor.assets,
      components: loaded.module.components,
    }))
  }

  private releaseLane(lane: PresentationLane | undefined): void {
    lane?.disposeTheme?.()
    lane?.experience?.handle.release()
  }

  private async buildArchive(): Promise<Uint8Array> {
    const name = this.snapshotValue.draftName.trim()
    if (name === '') throw new TypeError('主题名称不能为空')
    const layer = structuredClone(this.snapshotValue.draft)
    const lightAsset = this.assets.find(asset => asset.objectUrl === layer.backdrop?.light.assetUrl)
    const darkAsset = this.assets.find(asset => asset.objectUrl === layer.backdrop?.dark.assetUrl)
    const schemaVersion = lightAsset !== undefined && darkAsset !== undefined
      ? SKIN_SCHEMA_VERSION_V2
      : SKIN_SCHEMA_VERSION
    const assets: SkinAssetManifest[] = []
    const zip: Zippable = {}
    for (const asset of this.assets) {
      const sha256 = await digest(asset.bytes)
      assets.push({
        path: asset.path,
        mimeType: asset.mimeType,
        sha256,
        bytes: asset.bytes.byteLength,
        ...(schemaVersion === SKIN_SCHEMA_VERSION_V2 ? { purpose: 'backdrop' as const } : {}),
      })
      zip[asset.path] = asset.bytes
    }
    if (layer.backdrop !== undefined) {
      for (const mode of [layer.backdrop.light, layer.backdrop.dark]) {
        if (mode.assetUrl === undefined) continue
        const asset = this.assets.find(candidate => candidate.objectUrl === mode.assetUrl)
        if (asset === undefined) throw new TypeError('背景资源未通过主题工作室加载，不能保存或导出')
        mode.assetUrl = `asset:${asset.path}`
      }
    }
    const common = {
      id: safeFilename(name).toLowerCase(),
      name,
      version: '1.0.0',
      themePartsVersion: THEME_PARTS_VERSION,
      capabilities: ['tokens', 'backdrop', 'component-parts'] as const,
      assets,
    }
    let manifest: SkinManifest
    if (lightAsset !== undefined && darkAsset !== undefined) {
      manifest = {
        schemaVersion: SKIN_SCHEMA_VERSION_V2,
        ...common,
        preview: {
          light: `asset:${lightAsset.path}`,
          dark: `asset:${darkAsset.path}`,
        },
      }
    } else {
      manifest = { schemaVersion: SKIN_SCHEMA_VERSION, ...common }
    }
    zip['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
    zip['theme.json'] = strToU8(`${JSON.stringify({ schemaVersion: SKIN_SCHEMA_VERSION, ...layer }, null, 2)}\n`)
    return zipSync(zip, { level: 6 })
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    this.busyCount += 1
    this.set({ busy: true, error: undefined })
    try {
      await operation()
    } catch (error) {
      this.fail(error)
    } finally {
      this.busyCount -= 1
      this.set({ busy: this.busyCount > 0 })
    }
  }

  private assertLocal(): void {
    if (!this.snapshotValue.localManagement) throw new TypeError('导入、编辑、删除和激活只能在 Host 本机执行')
  }

  private async loadManagedAssets(layer: ThemeLayerDefinition): Promise<DraftAsset[]> {
    if (layer.backdrop === undefined) return []
    const loaded = new Map<string, DraftAsset>()
    try {
      for (const mode of [layer.backdrop.light, layer.backdrop.dark]) {
        if (mode.assetUrl === undefined) continue
        const match = /^\/api\/dsh-skin\/assets\/[a-f0-9]{64}\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u.exec(mode.assetUrl)
        if (match === null) continue
        let asset = loaded.get(mode.assetUrl)
        if (asset === undefined) {
          const response = await fetch(mode.assetUrl)
          if (!response.ok) throw new Error(`背景资源加载失败 (${String(response.status)})`)
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) throw new TypeError('背景图片必须小于 16 MiB')
          const mimeType = imageMime(response.headers.get('content-type')?.split(';', 1)[0] ?? '')
          const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
          await decodeImage(objectUrl).catch((error) => {
            URL.revokeObjectURL(objectUrl)
            throw error
          })
          asset = { bytes, mimeType, path: `assets/${match[1] as string}`, objectUrl }
          loaded.set(mode.assetUrl, asset)
        }
        mode.assetUrl = asset.objectUrl
      }
    } catch (error) {
      for (const asset of loaded.values()) URL.revokeObjectURL(asset.objectUrl)
      throw error
    }
    return [...loaded.values()]
  }

  private replaceAssets(assets: DraftAsset[]): void {
    const retained = new Set(assets)
    for (const asset of this.assets) {
      if (!retained.has(asset)) URL.revokeObjectURL(asset.objectUrl)
    }
    this.assets = assets
  }

  private revokeAssets(): void {
    for (const asset of this.assets) URL.revokeObjectURL(asset.objectUrl)
    this.assets = []
  }

  private fail(error: unknown): void {
    this.set({ error: error instanceof Error ? error.message : String(error) })
  }

  private set(patch: Partial<StudioSnapshot>): void {
    this.snapshotValue = Object.freeze({ ...this.snapshotValue, ...patch })
    for (const listener of [...this.listeners]) listener()
  }
}

function starterLayer(): ThemeLayerDefinition {
  return {
    tokens: {
      '--dsw-alias-bg-base': { light: '#f4f7fb', dark: '#0b1020' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#151c30' },
      '--dsw-alias-label-primary': { light: '#152038', dark: '#f3f6ff' },
      '--dsw-alias-brand-primary': { light: '#315efb', dark: '#7c9cff' },
      '--dsw-specific-sidebar-fill': { light: '#eaf0fb', dark: '#11182a' },
    },
    backdrop: {
      light: { ...EMPTY_BACKDROP },
      dark: { ...EMPTY_BACKDROP, fallbackColor: '#0b1020', dim: 0.28 },
    },
    partStyles: [
      {
        part: 'primitive.button', variant: 'primary',
        style: {
          light: { background: { token: '--dsw-alias-brand-primary' }, foreground: '#ffffff', borderRadiusPx: 14 },
          dark: { background: { token: '--dsw-alias-brand-primary' }, foreground: '#081024', borderRadiusPx: 14 },
        },
      },
      {
        part: 'conversation.composer',
        style: {
          light: { background: '#ffffff', borderColor: '#cbd6ea', borderRadiusPx: 20, shadows: [{ xPx: 0, yPx: 8, blurPx: 24, spreadPx: 0, color: '#1f3f7a22' }] },
          dark: { background: '#151c30', borderColor: '#34415f', borderRadiusPx: 20, shadows: [{ xPx: 0, yPx: 8, blurPx: 24, spreadPx: 0, color: '#00000055' }] },
        },
      },
      {
        part: 'conversation.message', variant: 'user',
        style: {
          light: { background: '#dfe9ff', borderRadiusPx: 22, paddingBlockPx: 10, paddingInlinePx: 16 },
          dark: { background: '#263657', borderRadiusPx: 22, paddingBlockPx: 10, paddingInlinePx: 16 },
        },
      },
    ],
  }
}

function partValue(field: string, value: string): ThemePartStyle[keyof ThemePartStyle] {
  if (field === 'foreground' || field === 'background' || field === 'borderColor') return colorValue(value)
  if (field === 'fontFamily' || field === 'borderStyle') return value as ThemePartStyle[keyof ThemePartStyle]
  if (field === 'shadows') {
    try {
      return JSON.parse(value) as ThemePartStyle['shadows']
    } catch (error) {
      throw new TypeError('shadows 必须是结构化阴影数组 JSON', { cause: error })
    }
  }
  const number = Number(value)
  if (!Number.isFinite(number)) throw new TypeError(`${field} 必须是数字`)
  return number as ThemePartStyle[keyof ThemePartStyle]
}

function colorValue(value: string): ThemeColorValue {
  return value.startsWith('$token:') ? { token: value.slice('$token:'.length) } : value
}

function imageMime(value: string): DraftAsset['mimeType'] {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value
  throw new TypeError('背景仅支持 PNG、JPEG 或 WebP')
}

function extension(mimeType: DraftAsset['mimeType']): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length)
}

function decodeImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => { resolve() }
    image.onerror = () => { reject(new TypeError('浏览器无法解码这张背景图片')) }
    image.src = url
  })
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function uploadArchive(bytes: Uint8Array): Promise<void> {
  await request(`${API}/import`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/zip' } })
}

async function request<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  })
  const envelope = await response.json() as { ok?: unknown; value?: T; error?: unknown }
  if (!response.ok || envelope.ok !== true) throw new Error(typeof envelope.error === 'string' ? envelope.error : `Skin request failed (${String(response.status)})`)
  return envelope.value as T
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9\u4e00-\u9fff_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'harness-skin'
}

class ExperienceObservable implements HostObservable<SkinExperienceSnapshot | undefined> {
  private readonly listeners = new Set<() => void>()
  private snapshot: SkinExperienceSnapshot | undefined

  getSnapshot = (): SkinExperienceSnapshot | undefined => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(snapshot: SkinExperienceSnapshot | undefined): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }
}

function validateExperienceModule(
  exportsValue: unknown,
  descriptor: SkinExperienceDescriptor,
): SkinExperienceModule {
  if (typeof exportsValue !== 'object' || exportsValue === null) {
    throw new TypeError('Experience Bundle 必须导出模块对象')
  }
  const namespace = exportsValue as Record<string, unknown>
  const candidate = typeof namespace.default === 'object' && namespace.default !== null
    ? namespace.default as Record<string, unknown>
    : namespace
  if (candidate.apiVersion !== 1) throw new TypeError('Experience Bundle apiVersion 必须为 1')
  if (typeof candidate.components !== 'object' || candidate.components === null || Array.isArray(candidate.components)) {
    throw new TypeError('Experience Bundle components 必须为组件映射')
  }
  const components = candidate.components as Record<string, unknown>
  const declared = new Set<SkinPlacement>(descriptor.placements)
  for (const key of Object.keys(components)) {
    if (!SKIN_PLACEMENTS.includes(key as SkinPlacement)) throw new TypeError(`Experience Bundle 含未知 Placement ${JSON.stringify(key)}`)
    if (!declared.has(key as SkinPlacement)) throw new TypeError(`Experience Bundle 未在 manifest 登记 Placement ${JSON.stringify(key)}`)
    if (typeof components[key] !== 'function') throw new TypeError(`Experience Placement ${JSON.stringify(key)} 必须导出 React 组件`)
  }
  for (const placement of declared) {
    if (typeof components[placement] !== 'function') throw new TypeError(`Experience Bundle 缺少已登记组件 ${JSON.stringify(placement)}`)
  }
  return Object.freeze({
    apiVersion: 1,
    components: Object.freeze({ ...components }) as SkinExperienceModule['components'],
  })
}

async function preloadLayerImages(layer: ThemeLayerDefinition): Promise<void> {
  if (layer.backdrop === undefined) return
  const urls = new Set([layer.backdrop.light.assetUrl, layer.backdrop.dark.assetUrl])
  await Promise.all([...urls].filter((url): url is string => url !== undefined).map(preloadImage))
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => { resolve() }
    image.onerror = () => { reject(new TypeError(`主题图片加载失败: ${url}`)) }
    image.src = url
  })
}
