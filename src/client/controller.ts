import { strToU8, zipSync, type Zippable } from 'fflate'
import { flushSync } from 'react-dom'
import type {
  CommitSkinResult, PrepareSkinResult, SkinAssetManifest,
  SkinDraftDescriptor, SkinHostState, SkinManifestV4, SkinVisualsV1, ThemeBackdropMode, ThemeColorValue,
  ThemeLayerV2, ThemePartId, ThemePartInspection, ThemePartRule, ThemePartStyle,
  ThemeTokenInspection, VisualSlotId, VisualTemplateKind,
} from '../shared/contracts.ts'
import { PLUGIN_VERSION, SKIN_SCHEMA_VERSION, SKIN_VISUALS_VERSION, THEME_PARTS_VERSION, THEME_SCHEMA_VERSION } from '../shared/contracts.ts'
import { THEME_PART_CATALOG, THEME_TOKEN_NAMES } from '../shared/theme-layer.ts'
import type { StudioSnapshot, ThemeService } from './contracts.ts'
import { presentSkinLayer, syncBackdropFlag } from './present.ts'
import { VISUAL_SLOT_CATALOG } from './visual-catalog.ts'

const API = '/api/dsh-skin'
const PREVIEW_SOURCE = '@ylq77147/dsh-skin-plugin/preview'
const DRAFT_VISUALS_UNCHANGED = Symbol('draft visuals unchanged')
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
  visuals?: SkinVisualsV1
  name: string
}

interface PresentationLane {
  key: string
  themeId: string
  layer?: ThemeLayerV2
  visuals?: SkinVisualsV1
  disposeTheme?: () => void
  setThemeEnabled?: (enabled: boolean) => void
}

interface PreviewIdentity {
  themeId: string
  fingerprint?: string
  visuals?: SkinVisualsV1
}

interface VisualPresenter {
  install(visuals: SkinVisualsV1, themeId: string): void
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
  private draftManifest: SkinManifestV4 = starterManifest('我的 Harness 皮肤')
  private draftVisuals: SkinVisualsV1 | undefined
  private past: DraftHistoryEntry[] = []
  private future: DraftHistoryEntry[] = []
  private baseline: DraftHistoryEntry
  private readonly disabledPartRules = new Map<string, ThemePartRule[]>()
  private mode: 'light' | 'dark'
  private busyCount = 0
  private refreshGeneration = 0
  private previewGeneration = 0

  constructor(
    private readonly theme: ThemeService,
    localManagement: boolean,
    private readonly visualRuntime?: VisualPresenter,
  ) {
    this.mode = theme.getTheme().active.colorScheme
    this.baseline = { layer: starterLayer(), name: '我的 Harness 皮肤' }
    this.snapshotValue = {
      host: undefined,
      draft: this.baseline.layer,
      draftVisuals: undefined,
      draftName: this.baseline.name,
      busy: false,
      previewing: false,
      dirty: false,
      canUndo: false,
      canRedo: false,
      changes: [],
      localManagement,
      versionMismatch: undefined,
      error: undefined,
      tokens: inspectTokens(),
      parts: inspectParts(),
    }
    this.visualRuntime?.setMode(this.mode)
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
      this.visualRuntime?.clear()
      this.revokeAssets()
    }
  }

  beginDraft(fingerprint?: string): void {
    void this.run(async () => {
      if (fingerprint === undefined) {
        const name = '我的 Harness 皮肤'
        this.draftManifest = starterManifest(name)
        this.draftVisuals = undefined
        this.visualRuntime?.clear()
        this.replaceDraft(starterLayer(), undefined, name, [])
        return
      }
      const source = await request<SkinDraftDescriptor>(`${API}/skins/${fingerprint}`)
      const draft = structuredClone(source.layer)
      const draftVisuals = source.visuals === undefined ? undefined : structuredClone(source.visuals)
      const assets = await this.loadDraftAssets(source.fingerprint, source.manifest, draft, draftVisuals)
      const manifest = structuredClone(source.manifest)
      if (source.source === 'builtin') {
        manifest.id = `${manifest.id}-custom`
        manifest.name = `${manifest.name} 副本`
      }
      this.draftManifest = manifest
      this.draftVisuals = draftVisuals
      if (draftVisuals === undefined) this.visualRuntime?.clear()
      else this.visualRuntime?.install(draftVisuals, source.fingerprint)
      this.replaceDraft(draft, draftVisuals, manifest.name, assets)
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
            ...(host.activeVisuals === undefined ? {} : { visuals: host.activeVisuals }),
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
    const generation = ++this.previewGeneration
    const previous = this.previewLane
    if (previous !== undefined) {
      previous.disposeTheme?.()
      this.previewLane = undefined
      this.activeLane?.setThemeEnabled?.(true)
      syncBackdropFlag(this.activeLane?.layer)
      this.set({ previewing: false, error: undefined })
    }
    this.restoreActiveVisuals(generation)
  }

  resumePreview(): void {
    if (this.previewLane !== undefined) return
    const generation = ++this.previewGeneration
    void this.run(async () => {
      const initialLayer = this.snapshotValue.draft
      await preloadLayerImages(initialLayer)
      if (generation !== this.previewGeneration) return
      const draftVisuals = this.draftVisuals
      if (draftVisuals !== undefined) await preloadVisualImages(draftVisuals)
      if (generation !== this.previewGeneration) return
      if (draftVisuals === undefined) this.visualRuntime?.clear()
      else this.visualRuntime?.install(draftVisuals, PREVIEW_SOURCE)
      const currentLayer = this.snapshotValue.draft
      if (currentLayer !== initialLayer) await preloadLayerImages(currentLayer)
      if (generation !== this.previewGeneration) return
      this.replacePreview(currentLayer, {
        themeId: PREVIEW_SOURCE,
        ...(draftVisuals === undefined ? {} : { visuals: draftVisuals }),
      })
    })
  }

  setColorScheme(mode: 'light' | 'dark'): void {
    this.theme.setTheme(mode)
  }

  /** Mirror the official ThemeRuntime's resolved mode for display purposes. */
  setResolvedMode(mode: 'light' | 'dark'): void {
    if (this.mode === mode) return
    this.mode = mode
    this.visualRuntime?.setMode(mode)
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
      const compatibility = host.runtime?.compatibility
      const compatible = host.runtime?.pluginVersion === PLUGIN_VERSION
        && compatibility?.skinSchemaVersion === SKIN_SCHEMA_VERSION
        && compatibility.visualsSchemaVersion === SKIN_VISUALS_VERSION
      const versionMismatch = compatible
        ? undefined
        : `Host ${host.runtime?.pluginVersion ?? '未知版本'} 与 Client ${PLUGIN_VERSION} 不一致。`
      this.set({ host, versionMismatch, error: undefined })
      await this.installActive({
        ...(host.activeFingerprint === undefined ? {} : { fingerprint: host.activeFingerprint }),
        ...(host.activeLayer === undefined ? {} : { layer: host.activeLayer }),
        ...(host.activeVisuals === undefined ? {} : { visuals: host.activeVisuals }),
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

    if (committed.layer !== undefined) await preloadLayerImages(committed.layer)
    if (expectedGeneration !== undefined && expectedGeneration !== this.refreshGeneration) return
    if (committed.visuals !== undefined) await preloadVisualImages(committed.visuals)
    if (expectedGeneration !== undefined && expectedGeneration !== this.refreshGeneration) return
    if (committed.visuals === undefined || committed.fingerprint === undefined) this.visualRuntime?.clear()
    else this.visualRuntime?.install(committed.visuals, committed.fingerprint)
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
        ...(committed.layer === undefined ? {} : { layer: committed.layer }),
        ...(committed.visuals === undefined ? {} : { visuals: committed.visuals }),
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
    if (prepared.visuals !== undefined) await preloadVisualImages(prepared.visuals)
    if (prepared.visuals === undefined) this.visualRuntime?.clear()
    else this.visualRuntime?.install(prepared.visuals, prepared.fingerprint)
    this.replacePreview(prepared.layer, {
      themeId: prepared.fingerprint,
      fingerprint: prepared.fingerprint,
      ...(prepared.visuals === undefined ? {} : { visuals: prepared.visuals }),
    })
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

  updatePartSurfaceSettings(
    part: string,
    variant: string,
    state: string,
    mode: 'light' | 'dark',
    field: 'fit' | 'positionX' | 'positionY',
    value: string,
  ): void {
    const layer = structuredClone(this.snapshotValue.draft)
    const normalizedVariant = variant === '' ? undefined : variant
    const normalizedState = state === '' ? undefined : state
    const rules = [...(layer.partStyles ?? [])]
    const at = rules.findIndex(rule => rule.part === part && rule.variant === normalizedVariant && rule.state === normalizedState)
    const previous = at < 0 ? undefined : rules[at]
    const surface = previous?.style[mode].surfaceImage
    if (surface === undefined) throw new TypeError(`组件 ${part} 的 ${mode} 模式尚未设置背景素材`)
    const nextValue = field === 'fit'
      ? (value === 'cover' || value === 'contain' ? value : undefined)
      : Number(value)
    if (nextValue === undefined || (typeof nextValue === 'number' && (!Number.isFinite(nextValue) || nextValue < 0 || nextValue > 1))) {
      throw new TypeError(`${field} 值无效`)
    }
    const style = { ...previous!.style[mode], surfaceImage: { ...surface, [field]: nextValue } }
    rules[at] = { ...previous!, style: { ...previous!.style, [mode]: style } }
    layer.partStyles = rules
    this.publishDraft(layer)
  }

  removePartSurfaceImage(part: string, variant: string, state: string, mode: 'light' | 'dark'): void {
    const layer = structuredClone(this.snapshotValue.draft)
    const normalizedVariant = variant === '' ? undefined : variant
    const normalizedState = state === '' ? undefined : state
    const rules = [...(layer.partStyles ?? [])]
    const at = rules.findIndex(rule => rule.part === part && rule.variant === normalizedVariant && rule.state === normalizedState)
    const previous = at < 0 ? undefined : rules[at]
    const removedUrl = previous?.style[mode].surfaceImage?.assetUrl
    if (previous === undefined || removedUrl === undefined) return
    const modeStyle = { ...previous.style[mode] }
    delete modeStyle.surfaceImage
    const nextRule = { ...previous, style: { ...previous.style, [mode]: modeStyle } }
    if (Object.keys(nextRule.style.light).length === 0 && Object.keys(nextRule.style.dark).length === 0) rules.splice(at, 1)
    else rules[at] = nextRule
    layer.partStyles = rules
    const referenced = new Set((layer.partStyles ?? []).flatMap(rule => [rule.style.light.surfaceImage?.assetUrl, rule.style.dark.surfaceImage?.assetUrl]))
    this.publishDraft(layer, this.snapshotValue.draftName, this.assets.filter(asset => asset.objectUrl !== removedUrl || referenced.has(removedUrl)))
  }

  configureVisual(slot: VisualSlotId, template: VisualTemplateKind, label: string, value: string): void {
    const definition = VISUAL_SLOT_CATALOG[slot]
    if (!definition.templates.includes(template)) throw new TypeError(`${slot} 不支持 ${template} 模板`)
    const normalizedLabel = label.trim().slice(0, 40)
    const normalizedValue = value.trim().slice(0, 40)
    if ((template === 'compact-brand' || template === 'status-chip') && normalizedLabel === '') {
      throw new TypeError(`${template} 模板必须填写文字`)
    }
    const current = this.draftVisuals?.items.find(item => item.slot === slot)
    const item = {
      id: current?.id ?? `${slot.replaceAll('.', '-')}-visual`,
      slot,
      template,
      ...(template === 'image-mark' || normalizedLabel === '' ? {} : { label: normalizedLabel }),
      ...(template !== 'status-chip' || normalizedValue === '' ? {} : { value: normalizedValue }),
      modes: current?.modes ?? { light: {}, dark: {} },
    } as const
    const items = [...(this.draftVisuals?.items ?? []).filter(candidate => candidate.slot !== slot), item]
    this.publishDraft(this.snapshotValue.draft, this.snapshotValue.draftName, undefined, { schemaVersion: SKIN_VISUALS_VERSION, items })
  }

  updateVisualMode(
    slot: VisualSlotId,
    mode: 'light' | 'dark',
    field: 'foreground' | 'background' | 'fit' | 'positionX' | 'positionY',
    value: string,
  ): void {
    const visuals = structuredClone(this.draftVisuals)
    const item = visuals?.items.find(candidate => candidate.slot === slot)
    if (visuals === undefined || item === undefined) throw new TypeError(`请先为 ${slot} 选择模板`)
    const nextValue = field === 'foreground' || field === 'background'
      ? colorValue(value)
      : field === 'fit'
        ? (value === 'cover' || value === 'contain' ? value : undefined)
        : Number(value)
    if (nextValue === undefined || (typeof nextValue === 'number' && (!Number.isFinite(nextValue) || nextValue < 0 || nextValue > 1))) {
      throw new TypeError(`${field} 值无效`)
    }
    item.modes[mode] = { ...item.modes[mode], [field]: nextValue }
    this.publishDraft(this.snapshotValue.draft, this.snapshotValue.draftName, undefined, visuals)
  }

  updateVisualImage(slot: VisualSlotId, mode: 'light' | 'dark', file: File): void {
    void this.run(async () => {
      if (file.size === 0 || file.size > 16 * 1024 * 1024) throw new TypeError('装饰素材必须小于 16 MiB')
      const visuals = structuredClone(this.draftVisuals)
      const item = visuals?.items.find(candidate => candidate.slot === slot)
      if (visuals === undefined || item === undefined) throw new TypeError(`请先为 ${slot} 选择模板`)
      const mimeType = imageMime(file.type)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
      try { await decodeImage(objectUrl) } catch (error) { URL.revokeObjectURL(objectUrl); throw error }
      const oldUrl = item.modes[mode].assetUrl
      item.modes[mode] = {
        ...item.modes[mode], assetUrl: objectUrl,
        fit: item.modes[mode].fit ?? 'contain',
        positionX: item.modes[mode].positionX ?? 0.5,
        positionY: item.modes[mode].positionY ?? 0.5,
      }
      const path = `assets/visual-${safeFilename(slot)}-${mode}.${extension(mimeType)}`
      const pathStem = path.replace(/\.[^.]+$/u, '')
      const assets = [
        ...this.assets.filter(asset => asset.path.replace(/\.[^.]+$/u, '') !== pathStem && asset.objectUrl !== oldUrl),
        { bytes, mimeType, path, objectUrl, purpose: 'visual' as const },
      ]
      this.publishDraft(this.snapshotValue.draft, this.snapshotValue.draftName, assets, visuals)
    })
  }

  removeVisualImage(slot: VisualSlotId, mode: 'light' | 'dark'): void {
    const visuals = structuredClone(this.draftVisuals)
    const item = visuals?.items.find(candidate => candidate.slot === slot)
    const removedUrl = item?.modes[mode].assetUrl
    if (visuals === undefined || item === undefined || removedUrl === undefined) return
    const nextMode = { ...item.modes[mode] }
    delete nextMode.assetUrl
    item.modes[mode] = nextMode
    const referenced = new Set(visuals.items.flatMap(candidate => [candidate.modes.light.assetUrl, candidate.modes.dark.assetUrl]))
    this.publishDraft(this.snapshotValue.draft, this.snapshotValue.draftName, this.assets.filter(asset => asset.objectUrl !== removedUrl || referenced.has(removedUrl)), visuals)
  }

  removeVisual(slot: VisualSlotId): void {
    if (this.draftVisuals === undefined) return
    const removed = this.draftVisuals.items.find(item => item.slot === slot)
    if (removed === undefined) return
    const items = this.draftVisuals.items.filter(item => item.slot !== slot)
    const visuals = items.length === 0 ? null : { schemaVersion: SKIN_VISUALS_VERSION, items }
    const removedUrls = new Set([removed.modes.light.assetUrl, removed.modes.dark.assetUrl])
    const referenced = new Set(items.flatMap(item => [item.modes.light.assetUrl, item.modes.dark.assetUrl]))
    this.publishDraft(
      this.snapshotValue.draft,
      this.snapshotValue.draftName,
      this.assets.filter(asset => !removedUrls.has(asset.objectUrl) || referenced.has(asset.objectUrl)),
      visuals,
    )
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

  private restoreActiveVisuals(expectedPreviewGeneration: number): void {
    if (expectedPreviewGeneration !== this.previewGeneration) return
    const active = this.activeLane
    if (active?.visuals === undefined) this.visualRuntime?.clear()
    else this.visualRuntime?.install(active.visuals, active.themeId)
  }

  private replacePreview(layer: ThemeLayerV2, identity: PreviewIdentity): void {
    this.previewGeneration += 1
    const previous = this.previewLane
    const presentation = presentSkinLayer({
      kind: 'preview',
      layer,
      ...(identity.fingerprint === undefined ? {} : { fingerprint: identity.fingerprint }),
    })
    flushSync(() => {
      this.activeLane?.setThemeEnabled?.(false)
      this.previewLane = {
        key: `preview:${identity.themeId}`,
        themeId: identity.themeId,
        layer,
        ...(identity.visuals === undefined ? {} : { visuals: identity.visuals }),
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
    visuals: SkinVisualsV1 | null | typeof DRAFT_VISUALS_UNCHANGED = DRAFT_VISUALS_UNCHANGED,
  ): void {
    const resolvedVisuals = visuals === DRAFT_VISUALS_UNCHANGED ? this.draftVisuals : visuals ?? undefined
    const next = {
      layer,
      ...(resolvedVisuals === undefined ? {} : { visuals: resolvedVisuals }),
      name: draftName,
    }
    if (sameHistory(this.historyEntry(), next) && replacementAssets === undefined) return
    this.past.push(this.historyEntry())
    if (this.past.length > 50) this.past.shift()
    this.future = []
    this.draftVisuals = resolvedVisuals
    const previewing = this.previewLane !== undefined
    this.applyDraft(next)
    try {
      if (previewing) {
        const draftVisuals = this.draftVisuals
        if (draftVisuals === undefined) this.visualRuntime?.clear()
        else this.visualRuntime?.install(draftVisuals, PREVIEW_SOURCE)
        this.replacePreview(layer, {
          themeId: PREVIEW_SOURCE,
          ...(draftVisuals === undefined ? {} : { visuals: draftVisuals }),
        })
      }
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

  private replaceDraft(layer: ThemeLayerV2, visuals: SkinVisualsV1 | undefined, name: string, assets: DraftAsset[]): void {
    this.draftVisuals = visuals
    const entry = { layer, ...(visuals === undefined ? {} : { visuals }), name }
    this.baseline = structuredClone(entry)
    this.past = []
    this.future = []
    this.disabledPartRules.clear()
    this.applyDraft(entry)
    try {
      if (visuals === undefined) this.visualRuntime?.clear()
      else this.visualRuntime?.install(visuals, PREVIEW_SOURCE)
      this.replacePreview(layer, {
        themeId: PREVIEW_SOURCE,
        ...(visuals === undefined ? {} : { visuals }),
      })
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
    return {
      layer: structuredClone(this.snapshotValue.draft),
      ...(this.draftVisuals === undefined ? {} : { visuals: structuredClone(this.draftVisuals) }),
      name: this.snapshotValue.draftName,
    }
  }

  private presentHistory(entry: DraftHistoryEntry): void {
    const copy = structuredClone(entry)
    this.draftVisuals = copy.visuals
    const previewing = this.previewLane !== undefined
    this.applyDraft(copy)
    try {
      if (previewing) {
        if (copy.visuals === undefined) this.visualRuntime?.clear()
        else this.visualRuntime?.install(copy.visuals, PREVIEW_SOURCE)
        this.replacePreview(copy.layer, {
          themeId: PREVIEW_SOURCE,
          ...(copy.visuals === undefined ? {} : { visuals: copy.visuals }),
        })
      }
    } catch (error) {
      this.fail(error)
    }
  }

  private applyDraft(entry: DraftHistoryEntry): void {
    const changes = draftChanges(this.baseline, entry)
    this.set({
      draft: entry.layer,
      draftVisuals: entry.visuals,
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
    const visuals = this.draftVisuals === undefined ? undefined : structuredClone(this.draftVisuals)
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
    for (const item of visuals?.items ?? []) {
      for (const mode of [item.modes.light, item.modes.dark]) {
        if (mode.assetUrl === undefined) continue
        const asset = this.assets.find(candidate => candidate.objectUrl === mode.assetUrl)
        if (asset === undefined || asset.purpose !== 'visual') {
          throw new TypeError('装饰图标资源未通过主题工作室加载，不能保存或导出')
        }
        mode.assetUrl = `asset:${asset.path}`
      }
    }
    const capabilities = [
      ...(Object.keys(layer.tokens).length === 0 ? [] : ['tokens' as const]),
      ...(layer.backdrop === undefined ? [] : ['backdrop' as const]),
      ...(layer.partStyles === undefined || layer.partStyles.length === 0 ? [] : ['component-parts' as const]),
      ...(visuals === undefined ? [] : ['component-visuals' as const]),
    ]
    const lightAsset = this.assets.find(asset => asset.objectUrl === this.snapshotValue.draft.backdrop?.light.assetUrl)
    const darkAsset = this.assets.find(asset => asset.objectUrl === this.snapshotValue.draft.backdrop?.dark.assetUrl)
    const preview = lightAsset !== undefined && darkAsset !== undefined
      ? { light: `asset:${lightAsset.path}`, dark: `asset:${darkAsset.path}` }
      : this.draftManifest.preview
    const { preview: _oldPreview, visuals: _oldVisuals, ...baseManifest } = this.draftManifest
    const manifest: SkinManifestV4 = {
      ...baseManifest,
      schemaVersion: SKIN_SCHEMA_VERSION,
      id: this.draftManifest.id || safeFilename(name).toLowerCase(),
      name,
      themePartsVersion: THEME_PARTS_VERSION,
      capabilities,
      assets,
      ...(preview === undefined ? {} : { preview }),
      ...(visuals === undefined ? {} : { visuals: { schemaVersion: SKIN_VISUALS_VERSION, entry: 'visuals.json' } }),
    }
    zip['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
    zip['theme.json'] = strToU8(`${JSON.stringify({ schemaVersion: THEME_SCHEMA_VERSION, ...layer }, null, 2)}\n`)
    if (visuals !== undefined) zip['visuals.json'] = strToU8(`${JSON.stringify(visuals, null, 2)}\n`)
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

  private async loadDraftAssets(
    fingerprint: string,
    manifest: SkinManifestV4,
    layer: ThemeLayerV2,
    visuals: SkinVisualsV1 | undefined,
  ): Promise<DraftAsset[]> {
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
      for (const item of visuals?.items ?? []) {
        for (const mode of [item.modes.light, item.modes.dark]) {
          if (mode.assetUrl !== undefined) mode.assetUrl = loaded.get(mode.assetUrl)?.objectUrl ?? mode.assetUrl
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

function starterManifest(name: string): SkinManifestV4 {
  return {
    schemaVersion: SKIN_SCHEMA_VERSION,
    id: safeFilename(name).toLowerCase(),
    name,
    version: '3.0.0',
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
  return left.name === right.name
    && JSON.stringify(left.layer) === JSON.stringify(right.layer)
    && JSON.stringify(left.visuals) === JSON.stringify(right.visuals)
}

function draftChanges(baseline: DraftHistoryEntry, current: DraftHistoryEntry): readonly string[] {
  const changes: string[] = []
  if (baseline.name !== current.name) changes.push('名称')
  if (JSON.stringify(baseline.layer.tokens) !== JSON.stringify(current.layer.tokens)) changes.push('语义 Token')
  if (JSON.stringify(baseline.layer.backdrop) !== JSON.stringify(current.layer.backdrop)) changes.push('背景')
  if (JSON.stringify(baseline.layer.partStyles) !== JSON.stringify(current.layer.partStyles)) changes.push('组件外观')
  if (JSON.stringify(baseline.visuals) !== JSON.stringify(current.visuals)) changes.push('图片与图标')
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

async function preloadVisualImages(visuals: SkinVisualsV1): Promise<void> {
  const urls = new Set<string>()
  for (const item of visuals.items) {
    if (item.modes.light.assetUrl !== undefined) urls.add(item.modes.light.assetUrl)
    if (item.modes.dark.assetUrl !== undefined) urls.add(item.modes.dark.assetUrl)
  }
  await Promise.all([...urls].map(preloadImage))
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => { resolve() }
    image.onerror = () => { reject(new TypeError(`主题图片加载失败: ${url}`)) }
    image.src = url
  })
}
