import { strToU8, zipSync, type Zippable } from 'fflate'
import { flushSync } from 'react-dom'
import type {
  CommitSkinResult, PrepareSkinResult, SkinAssetManifest,
  SkinDraftDescriptor, SkinExperienceDescriptor, SkinHostState, SkinManifestV3, ThemeBackdropMode, ThemeColorValue,
  ThemeLayerV2, ThemePartId, ThemePartInspection, ThemePartRule, ThemePartStyle,
  ThemeTokenInspection,
} from '../shared/contracts.ts'
import { SKIN_SCHEMA_VERSION, THEME_PARTS_VERSION, THEME_SCHEMA_VERSION } from '../shared/contracts.ts'
import { THEME_PART_CATALOG, THEME_TOKEN_NAMES } from '../shared/theme-layer.ts'
import type { StudioSnapshot, ThemeService } from './contracts.ts'
import { presentSkinLayer, syncBackdropFlag } from './present.ts'

const API = '/api/dsh-skin'
const PREVIEW_SOURCE = '@ylq77147/dsh-skin-plugin/preview'
const EMPTY_BACKDROP: ThemeBackdropMode = {
  fallbackColor: '#f5f7fb', focusX: 0.5, focusY: 0.5, dim: 0.12, blurPx: 0,
}

interface DraftAsset {
  bytes: Uint8Array
  mimeType: SkinAssetManifest['mimeType']
  path: string
  objectUrl: string
  purpose: SkinAssetManifest['purpose']
}

interface DraftHistoryEntry {
  layer: ThemeLayerV2
  name: string
}

interface PresentationLane {
  key: string
  themeId: string
  skinId?: string
  layer?: ThemeLayerV2
  experience?: SkinExperienceDescriptor
  disposeTheme?: () => void
  setThemeEnabled?: (enabled: boolean) => void
}

interface ExperiencePresenter {
  install(descriptor: SkinExperienceDescriptor, themeId: string, skinId?: string): Promise<void>
  clear(): void
  setMode(mode: 'light' | 'dark'): void
}

/** Browser controller: one complete draft per update and one active/overlay lane per presentation. */
export class SkinStudioController {
  private readonly listeners = new Set<() => void>()
  private snapshotValue: StudioSnapshot
  private activeLane: PresentationLane | undefined
  private previewLane: PresentationLane | undefined
  private eventSource: EventSource | undefined
  private assets: DraftAsset[] = []
  private draftManifest: SkinManifestV3 = starterManifest('我的 Harness 皮肤')
  private draftExperienceBytes: Uint8Array | undefined
  private past: DraftHistoryEntry[] = []
  private future: DraftHistoryEntry[] = []
  private baseline: DraftHistoryEntry
  private readonly disabledPartRules = new Map<string, ThemePartRule[]>()
  private mode: 'light' | 'dark'
  private busyCount = 0
  private refreshGeneration = 0

  constructor(
    private readonly theme: ThemeService,
    localManagement: boolean,
    private readonly experience?: ExperiencePresenter,
  ) {
    this.mode = theme.getTheme().active.colorScheme
    this.baseline = { layer: starterLayer(), name: '我的 Harness 皮肤' }
    this.snapshotValue = {
      host: undefined,
      draft: this.baseline.layer,
      draftName: this.baseline.name,
      busy: false,
      previewing: false,
      dirty: false,
      canUndo: false,
      canRedo: false,
      changes: [],
      localManagement,
      error: undefined,
      tokens: inspectTokens(),
      parts: inspectParts(),
    }
    this.experience?.setMode(this.mode)
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
      const refresh = (): void => { void this.refresh() }
      this.eventSource.addEventListener('ready', refresh)
      this.eventSource.addEventListener('skin-change', refresh)
    }
    return () => {
      this.eventSource?.close()
      this.eventSource = undefined
      this.releaseLane(this.previewLane)
      this.previewLane = undefined
      this.releaseLane(this.activeLane)
      this.activeLane = undefined
      syncBackdropFlag(undefined)
      this.experience?.clear()
      this.revokeAssets()
    }
  }

  beginDraft(fingerprint?: string): void {
    void this.run(async () => {
      if (fingerprint === undefined) {
        const name = '我的 Harness 皮肤'
        this.draftManifest = starterManifest(name)
        this.draftExperienceBytes = undefined
        this.experience?.clear()
        this.replaceDraft(starterLayer(), name, [])
        return
      }
      const source = await request<SkinDraftDescriptor>(`${API}/skins/${fingerprint}`)
      const skinId = source.manifest.id
      const draft = structuredClone(source.layer)
      const assets = await this.loadDraftAssets(source.fingerprint, source.manifest, draft)
      const experienceBytes = source.experience === undefined
        ? undefined
        : await fetchBytes(source.experience.url, 2 * 1024 * 1024, 'Experience Bundle')
      const manifest = structuredClone(source.manifest)
      if (source.source === 'builtin') {
        manifest.id = `${manifest.id}-custom`
        manifest.name = `${manifest.name} 副本`
      }
      this.draftManifest = manifest
      this.draftExperienceBytes = experienceBytes
      if (source.experience === undefined) this.experience?.clear()
      else await this.experience?.install(source.experience, source.fingerprint, skinId)
      this.replaceDraft(draft, manifest.name, assets)
    })
  }

  updateDraftName(name: string): void {
    this.publishDraft(this.snapshotValue.draft, name.slice(0, 120))
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
        ...this.assets.filter(asset => asset.purpose !== 'backdrop' || referenced.has(asset.objectUrl)),
        { bytes, mimeType, path: `assets/backdrop-${mode}.${extension(mimeType)}`, objectUrl, purpose: 'backdrop' as const },
      ]
      this.publishDraft(layer, this.snapshotValue.draftName, assets)
    })
  }

  upsertPartRule(part: string, variant: string, state: string, field: string, light: string, dark: string): void {
    try {
      const catalog = THEME_PART_CATALOG[part as ThemePartId]
      if (catalog === undefined) throw new TypeError(`未知组件 Part: ${part}`)
      if (variant !== '' && !(catalog.variants as readonly string[]).includes(variant)) throw new TypeError(`组件 ${part} 不支持 Variant ${variant}`)
      if (state !== '' && !(catalog.states as readonly string[]).includes(state)) throw new TypeError(`组件 ${part} 不支持 State ${state}`)
      if (!(catalog.properties as readonly string[]).includes(field) || field === 'surfaceImage') throw new TypeError(`组件 ${part} 不支持属性 ${field}`)
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
      this.markSaved()
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
      let committed: CommitSkinResult
      let commitAttempted = false
      try {
        await this.installPreparedPreview(prepared)
        commitAttempted = true
        committed = await request<CommitSkinResult>(`${API}/commit`, {
          method: 'POST', body: JSON.stringify({ preparationId: prepared.preparationId }),
        })
      } catch (error) {
        const host = commitAttempted
          ? await request<SkinHostState>(`${API}/state`).catch(() => undefined)
          : undefined
        if (
          host?.activeFingerprint === prepared.fingerprint
          && host.activeLayer !== undefined
          && host.activationRevision > prepared.activationRevision
        ) {
          this.set({ host, error: undefined })
          await this.installActive({
            fingerprint: host.activeFingerprint,
            layer: host.activeLayer,
            ...(host.activeExperience === undefined ? {} : { experience: host.activeExperience }),
            activationRevision: host.activationRevision,
          })
          return
        }
        await request(`${API}/cancel`, { method: 'POST', body: JSON.stringify({ preparationId: prepared.preparationId }) }).catch(() => undefined)
        this.cancelPreview()
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
    previous.disposeTheme?.()
    this.previewLane = undefined
    this.activeLane?.setThemeEnabled?.(true)
    syncBackdropFlag(this.activeLane?.layer)
    this.set({ previewing: false, error: undefined })
    void this.restoreActiveExperience()
  }

  setColorScheme(mode: 'light' | 'dark'): void {
    this.theme.setTheme(mode)
  }

  /** Mirror the official ThemeRuntime's resolved mode for display purposes. */
  setResolvedMode(mode: 'light' | 'dark'): void {
    if (this.mode === mode) return
    this.mode = mode
    this.experience?.setMode(mode)
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
      }, generation)
    } catch (error) {
      if (generation === this.refreshGeneration) this.fail(error)
    }
  }

  private async installActive(committed: CommitSkinResult, expectedGeneration?: number): Promise<void> {
    const key = committed.layer === undefined || committed.fingerprint === undefined
      ? `default:${String(committed.activationRevision)}`
      : `${committed.fingerprint}:${String(committed.activationRevision)}`
    if (this.activeLane?.key === key && this.previewLane === undefined) return

    const skinId = committed.fingerprint === undefined
      ? undefined
      : this.snapshotValue.host?.skins.find(skin => skin.fingerprint === committed.fingerprint)?.id
    if (committed.layer !== undefined) await preloadLayerImages(committed.layer)
    if (expectedGeneration !== undefined && expectedGeneration !== this.refreshGeneration) return
    if (committed.experience === undefined || committed.fingerprint === undefined) this.experience?.clear()
    else await this.experience?.install(committed.experience, committed.fingerprint, skinId)
    if (expectedGeneration !== undefined && expectedGeneration !== this.refreshGeneration) return
    const presentation = committed.layer === undefined || committed.fingerprint === undefined
      ? undefined
      : presentSkinLayer({
          kind: 'active',
          layer: committed.layer,
          fingerprint: committed.fingerprint,
          activationRevision: committed.activationRevision,
        })

    const oldActive = this.activeLane
    const oldPreview = this.previewLane
    flushSync(() => {
      oldPreview?.disposeTheme?.()
      this.activeLane = {
        key,
        themeId: committed.fingerprint ?? 'harness-default',
        ...(skinId === undefined ? {} : { skinId }),
        ...(committed.layer === undefined ? {} : { layer: committed.layer }),
        ...(committed.experience === undefined ? {} : { experience: committed.experience }),
        ...(presentation === undefined ? {} : {
          disposeTheme: presentation.dispose,
          setThemeEnabled: presentation.setEnabled,
        }),
      }
      this.previewLane = undefined
      this.set({ previewing: false, error: undefined })
    })
    this.releaseLane(oldActive)
    if (oldPreview !== undefined) this.releaseLane(oldPreview)
    // Last writer wins, keyed to the committed layer: lane dispose no longer
    // touches the flag, so activation applies the new backdrop without reload.
    syncBackdropFlag(committed.layer)
  }

  private async installPreparedPreview(prepared: PrepareSkinResult): Promise<void> {
    if (prepared.layer === undefined || prepared.fingerprint === undefined) {
      throw new Error('Host returned an incomplete skin preparation')
    }
    await preloadLayerImages(prepared.layer)
    if (prepared.experience === undefined) this.experience?.clear()
    else await this.experience?.install(
      prepared.experience,
      prepared.fingerprint,
      this.snapshotValue.host?.skins.find(skin => skin.fingerprint === prepared.fingerprint)?.id,
    )
    this.replacePreview(prepared.layer, prepared.fingerprint)
  }

  setPartEnabled(part: string, enabled: boolean): void {
    const layer = structuredClone(this.snapshotValue.draft)
    const rules = [...(layer.partStyles ?? [])]
    if (!enabled) {
      const removed = rules.filter(rule => rule.part === part)
      if (removed.length === 0) return
      this.disabledPartRules.set(part, removed)
      layer.partStyles = rules.filter(rule => rule.part !== part)
      this.publishDraft(layer)
      return
    }
    const cached = this.disabledPartRules.get(part)
    if (cached === undefined || rules.some(rule => rule.part === part)) return
    layer.partStyles = [...rules, ...structuredClone(cached)]
    this.publishDraft(layer)
  }

  resetPartProperty(part: string, variant: string, state: string, field: keyof ThemePartStyle): void {
    const layer = structuredClone(this.snapshotValue.draft)
    const normalizedVariant = variant === '' ? undefined : variant
    const normalizedState = state === '' ? undefined : state
    const rules: ThemePartRule[] = []
    for (const rule of layer.partStyles ?? []) {
      if (rule.part !== part || rule.variant !== normalizedVariant || rule.state !== normalizedState) {
        rules.push(rule)
        continue
      }
      const light = { ...rule.style.light }
      const dark = { ...rule.style.dark }
      delete light[field]
      delete dark[field]
      if (Object.keys(light).length > 0 || Object.keys(dark).length > 0) {
        rules.push({ ...rule, style: { light, dark } })
      }
    }
    layer.partStyles = rules
    this.publishDraft(layer)
  }

  updatePartSurfaceImage(part: string, variant: string, state: string, mode: 'light' | 'dark', file: File): void {
    void this.run(async () => {
      const catalog = THEME_PART_CATALOG[part as ThemePartId]
      if (catalog === undefined || !catalog.properties.includes('surfaceImage')) {
        throw new TypeError(`组件 ${part} 不支持背景素材`)
      }
      if (file.size === 0 || file.size > 16 * 1024 * 1024) throw new TypeError('组件背景图片必须小于 16 MiB')
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
      const normalizedVariant = variant === '' ? undefined : variant
      const normalizedState = state === '' ? undefined : state
      const rules = [...(layer.partStyles ?? [])]
      const at = rules.findIndex(rule => rule.part === part && rule.variant === normalizedVariant && rule.state === normalizedState)
      const previous = at < 0 ? undefined : rules[at]
      const modeStyle = {
        ...(previous?.style[mode] ?? {}),
        surfaceImage: { assetUrl: objectUrl, fit: 'cover' as const, positionX: 0.5, positionY: 0.5 },
      }
      const rule: ThemePartRule = {
        part: part as ThemePartId,
        ...(normalizedVariant === undefined ? {} : { variant: normalizedVariant as NonNullable<ThemePartRule['variant']> }),
        ...(normalizedState === undefined ? {} : { state: normalizedState as NonNullable<ThemePartRule['state']> }),
        style: {
          light: mode === 'light' ? modeStyle : previous?.style.light ?? {},
          dark: mode === 'dark' ? modeStyle : previous?.style.dark ?? {},
        },
      }
      if (at < 0) rules.push(rule)
      else rules[at] = rule
      layer.partStyles = rules
      const path = `assets/component-${safeFilename(`${part}-${variant || 'default'}-${state || 'base'}`)}-${mode}.${extension(mimeType)}`
      const pathStem = path.replace(/\.[^.]+$/u, '')
      this.publishDraft(layer, this.snapshotValue.draftName, [
        ...this.assets.filter(asset => asset.path.replace(/\.[^.]+$/u, '') !== pathStem),
        { bytes, mimeType, path, objectUrl, purpose: 'component' },
      ])
    })
  }

  undo(): void {
    const previous = this.past.pop()
    if (previous === undefined) return
    this.future.push(this.historyEntry())
    this.presentHistory(previous)
  }

  redo(): void {
    const next = this.future.pop()
    if (next === undefined) return
    this.past.push(this.historyEntry())
    this.presentHistory(next)
  }

  private async restoreActiveExperience(): Promise<void> {
    try {
      const active = this.activeLane
      if (active?.experience === undefined) this.experience?.clear()
      else await this.experience?.install(active.experience, active.themeId, active.skinId)
    } catch (error) {
      this.fail(error)
    }
  }

  private replacePreview(layer: ThemeLayerV2, themeId: string): void {
    const previous = this.previewLane
    const presentation = presentSkinLayer({
      kind: 'preview',
      layer,
      ...(themeId === PREVIEW_SOURCE ? {} : { fingerprint: themeId }),
    })
    flushSync(() => {
      this.activeLane?.setThemeEnabled?.(false)
      this.previewLane = {
        key: `preview:${themeId}`,
        themeId,
        disposeTheme: presentation.dispose,
      }
      this.set({ previewing: true, error: undefined })
    })
    this.releaseLane(previous)
    syncBackdropFlag(layer)
  }

  private publishDraft(
    layer: ThemeLayerV2,
    draftName = this.snapshotValue.draftName,
    replacementAssets?: DraftAsset[],
  ): void {
    const next = { layer, name: draftName }
    if (sameHistory(this.historyEntry(), next) && replacementAssets === undefined) return
    this.past.push(this.historyEntry())
    if (this.past.length > 50) this.past.shift()
    this.future = []
    this.applyDraft(next)
    try {
      this.replacePreview(layer, PREVIEW_SOURCE)
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

  private replaceDraft(layer: ThemeLayerV2, name: string, assets: DraftAsset[]): void {
    const entry = { layer, name }
    this.baseline = structuredClone(entry)
    this.past = []
    this.future = []
    this.disabledPartRules.clear()
    this.applyDraft(entry)
    try {
      this.replacePreview(layer, PREVIEW_SOURCE)
      this.replaceAssets(assets)
    } catch (error) {
      const existing = new Set(this.assets)
      for (const asset of assets) {
        if (!existing.has(asset)) URL.revokeObjectURL(asset.objectUrl)
      }
      this.fail(error)
    }
  }

  private historyEntry(): DraftHistoryEntry {
    return { layer: structuredClone(this.snapshotValue.draft), name: this.snapshotValue.draftName }
  }

  private presentHistory(entry: DraftHistoryEntry): void {
    const copy = structuredClone(entry)
    this.applyDraft(copy)
    try {
      this.replacePreview(copy.layer, PREVIEW_SOURCE)
    } catch (error) {
      this.fail(error)
    }
  }

  private applyDraft(entry: DraftHistoryEntry): void {
    const changes = draftChanges(this.baseline, entry)
    this.set({
      draft: entry.layer,
      draftName: entry.name,
      dirty: changes.length > 0,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      changes,
    })
  }

  private markSaved(): void {
    this.baseline = this.historyEntry()
    this.past = []
    this.future = []
    this.applyDraft(this.baseline)
  }

  private releaseLane(lane: PresentationLane | undefined): void {
    lane?.disposeTheme?.()
  }

  private async buildArchive(): Promise<Uint8Array> {
    const name = this.snapshotValue.draftName.trim()
    if (name === '') throw new TypeError('主题名称不能为空')
    const layer = structuredClone(this.snapshotValue.draft)
    const assets: SkinAssetManifest[] = []
    const zip: Zippable = {}
    for (const asset of this.assets) {
      const sha256 = await digest(asset.bytes)
      assets.push({
        path: asset.path,
        mimeType: asset.mimeType,
        sha256,
        bytes: asset.bytes.byteLength,
        purpose: asset.purpose,
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
    for (const rule of layer.partStyles ?? []) {
      for (const style of [rule.style.light, rule.style.dark]) {
        const surfaceImage = style.surfaceImage
        if (surfaceImage === undefined) continue
        const url = surfaceImage.assetUrl
        const asset = this.assets.find(candidate => candidate.objectUrl === url)
        if (asset === undefined || asset.purpose !== 'component') {
          throw new TypeError('组件背景资源未通过主题工作室加载，不能保存或导出')
        }
        style.surfaceImage = { ...surfaceImage, assetUrl: `asset:${asset.path}` }
      }
    }
    const capabilities = [
      ...(Object.keys(layer.tokens).length === 0 ? [] : ['tokens' as const]),
      ...(layer.backdrop === undefined ? [] : ['backdrop' as const]),
      ...(layer.partStyles === undefined || layer.partStyles.length === 0 ? [] : ['component-parts' as const]),
      ...(this.draftExperienceBytes === undefined ? [] : ['component-experience' as const]),
    ]
    const lightAsset = this.assets.find(asset => asset.objectUrl === this.snapshotValue.draft.backdrop?.light.assetUrl)
    const darkAsset = this.assets.find(asset => asset.objectUrl === this.snapshotValue.draft.backdrop?.dark.assetUrl)
    const preview = lightAsset !== undefined && darkAsset !== undefined
      ? { light: `asset:${lightAsset.path}`, dark: `asset:${darkAsset.path}` }
      : this.draftManifest.preview
    const experience = this.draftExperienceBytes === undefined || this.draftManifest.experience === undefined
      ? undefined
      : {
          ...this.draftManifest.experience,
          sha256: await digest(this.draftExperienceBytes),
          bytes: this.draftExperienceBytes.byteLength,
        }
    const { preview: _oldPreview, experience: _oldExperience, ...baseManifest } = this.draftManifest
    const manifest: SkinManifestV3 = {
      ...baseManifest,
      schemaVersion: SKIN_SCHEMA_VERSION,
      id: this.draftManifest.id || safeFilename(name).toLowerCase(),
      name,
      themePartsVersion: THEME_PARTS_VERSION,
      capabilities,
      assets,
      ...(preview === undefined ? {} : { preview }),
      ...(experience === undefined ? {} : { experience }),
    }
    zip['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
    zip['theme.json'] = strToU8(`${JSON.stringify({ schemaVersion: THEME_SCHEMA_VERSION, ...layer }, null, 2)}\n`)
    if (this.draftExperienceBytes !== undefined) zip['experience/client.js'] = this.draftExperienceBytes
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

  private async loadDraftAssets(fingerprint: string, manifest: SkinManifestV3, layer: ThemeLayerV2): Promise<DraftAsset[]> {
    const loaded = new Map<string, DraftAsset>()
    try {
      for (const declaration of manifest.assets) {
        const filename = declaration.path.slice('assets/'.length)
        const managedUrl = `${API}/assets/${fingerprint}/${filename}`
        const response = await fetch(managedUrl)
        if (!response.ok) throw new Error(`皮肤资源加载失败 (${String(response.status)})`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength !== declaration.bytes) throw new TypeError(`皮肤资源大小发生变化: ${declaration.path}`)
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: declaration.mimeType }))
        await decodeImage(objectUrl).catch((error) => {
          URL.revokeObjectURL(objectUrl)
          throw error
        })
        loaded.set(managedUrl, {
          bytes,
          mimeType: declaration.mimeType,
          path: declaration.path,
          objectUrl,
          purpose: declaration.purpose,
        })
      }
      if (layer.backdrop !== undefined) {
        for (const mode of [layer.backdrop.light, layer.backdrop.dark]) {
          if (mode.assetUrl !== undefined) mode.assetUrl = loaded.get(mode.assetUrl)?.objectUrl ?? mode.assetUrl
        }
      }
      for (const rule of layer.partStyles ?? []) {
        for (const style of [rule.style.light, rule.style.dark]) {
          if (style.surfaceImage !== undefined) {
            style.surfaceImage.assetUrl = loaded.get(style.surfaceImage.assetUrl)?.objectUrl ?? style.surfaceImage.assetUrl
          }
        }
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

/** Token picker data, generated locally from the internalized catalog. */
function inspectTokens(): readonly ThemeTokenInspection[] {
  return Object.freeze(THEME_TOKEN_NAMES.map(name => Object.freeze({
    name,
    description: name,
    valueType: 'color',
    requiresLightAndDark: true,
    cssVariable: name,
  })))
}

/** Part picker data, generated locally from the internalized catalog. */
function inspectParts(): readonly ThemePartInspection[] {
  return Object.freeze((Object.keys(THEME_PART_CATALOG) as ThemePartId[]).map((id) => {
    const entry = THEME_PART_CATALOG[id]
    return Object.freeze({
      id,
      variants: entry.variants,
      states: entry.states,
      properties: entry.properties,
    })
  }))
}

function starterLayer(): ThemeLayerV2 {
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

function starterManifest(name: string): SkinManifestV3 {
  return {
    schemaVersion: SKIN_SCHEMA_VERSION,
    id: safeFilename(name).toLowerCase(),
    name,
    version: '2.0.0',
    tags: [],
    themePartsVersion: THEME_PARTS_VERSION,
    capabilities: ['tokens', 'backdrop', 'component-parts'],
    assets: [],
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

async function fetchBytes(url: string, limit: number, label: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Accept: 'application/octet-stream' } })
  if (!response.ok) throw new Error(`${label} 加载失败 (${String(response.status)})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > limit) throw new TypeError(`${label} 大小无效`)
  return bytes
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
  return value.trim().replace(/[^A-Za-z0-9一-鿿_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'harness-skin'
}

function sameHistory(left: DraftHistoryEntry, right: DraftHistoryEntry): boolean {
  return left.name === right.name && JSON.stringify(left.layer) === JSON.stringify(right.layer)
}

function draftChanges(baseline: DraftHistoryEntry, current: DraftHistoryEntry): readonly string[] {
  const changes: string[] = []
  if (baseline.name !== current.name) changes.push('名称')
  if (JSON.stringify(baseline.layer.tokens) !== JSON.stringify(current.layer.tokens)) changes.push('语义 Token')
  if (JSON.stringify(baseline.layer.backdrop) !== JSON.stringify(current.layer.backdrop)) changes.push('背景')
  if (JSON.stringify(baseline.layer.partStyles) !== JSON.stringify(current.layer.partStyles)) changes.push('组件外观')
  return Object.freeze(changes)
}

async function preloadLayerImages(layer: ThemeLayerV2): Promise<void> {
  const urls = new Set<string | undefined>()
  if (layer.backdrop !== undefined) {
    urls.add(layer.backdrop.light.assetUrl)
    urls.add(layer.backdrop.dark.assetUrl)
  }
  for (const rule of layer.partStyles ?? []) {
    urls.add(rule.style.light.surfaceImage?.assetUrl)
    urls.add(rule.style.dark.surfaceImage?.assetUrl)
  }
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
