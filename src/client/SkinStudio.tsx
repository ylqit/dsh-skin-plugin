import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkinStudioInjected, StudioSnapshot } from './contracts.ts'
import { PLUGIN_VERSION, SKIN_SCHEMA_VERSION, type ThemeColorValue, type ThemeLayerV2, type ThemePartId, type ThemePartStyle, type VisualTemplateKind } from '../shared/contracts.ts'
import { THEME_PART_GUIDES, type PartGuideGroup } from '../shared/part-guides.ts'
import { VISUAL_SLOT_BY_PART, VISUAL_SLOT_CATALOG } from './visual-catalog.ts'
import css from './SkinStudio.module.css'

type SkinStudioProps = Omit<SkinStudioInjected, 'hooks'> & {
  useStudio<T>(selector: (state: StudioSnapshot) => T, equal?: (left: T, right: T) => boolean): T
}

type PrimaryTab = 'library' | 'editor'
type EditorTab = 'components' | 'tokens' | 'backdrop'
type ComponentTab = 'appearance' | 'visuals' | 'state'

const EDITABLE_PART_FIELDS: readonly (keyof ThemePartStyle)[] = [
  'foreground', 'background', 'borderColor', 'borderWidthPx', 'borderRadiusPx',
  'borderStyle', 'shadows', 'opacity', 'backdropBlurPx', 'paddingBlockPx',
  'paddingInlinePx', 'gapPx', 'fontFamily', 'fontSizePx', 'fontWeight',
  'lineHeight', 'letterSpacingPx', 'transitionDurationMs',
]

const GUIDE_GROUPS: readonly PartGuideGroup[] = ['框架', '会话', '基础控件', '菜单与弹窗', '工具', '设置']

/** Bounded Settings workbench for library management and one-snapshot live try-on. */
export function SkinStudio(props: SkinStudioProps): ReactNode {
  const state = props.useStudio(value => value)
  const importRef = useRef<HTMLInputElement>(null)
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('library')
  const [editorTab, setEditorTab] = useState<EditorTab>('components')
  const [componentTab, setComponentTab] = useState<ComponentTab>('appearance')
  const [galleryMode, setGalleryMode] = useState<'light' | 'dark'>('light')
  const [part, setPart] = useState<ThemePartId>(state.parts[0]?.id ?? 'primitive.button')
  const [partSearch, setPartSearch] = useState('')
  const [variant, setVariant] = useState('')
  const [partState, setPartState] = useState('')
  const [field, setField] = useState<keyof ThemePartStyle>('background')
  const [lightValue, setLightValue] = useState('#315efb')
  const [darkValue, setDarkValue] = useState('#7c9cff')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [visualTemplate, setVisualTemplate] = useState<VisualTemplateKind>('image-mark')
  const [visualLabel, setVisualLabel] = useState('')
  const [visualValue, setVisualValue] = useState('')

  const partInfo = state.parts.find(value => value.id === part)
  const guide = THEME_PART_GUIDES[part]
  const visualSlot = VISUAL_SLOT_BY_PART[part]
  const visualDefinition = visualSlot === undefined ? undefined : VISUAL_SLOT_CATALOG[visualSlot]
  const visualItem = state.draftVisuals?.items.find(item => item.slot === visualSlot)
  const rule = state.draft.partStyles?.find(value => value.part === part
    && (value.variant ?? '') === variant
    && (value.state ?? '') === partState)
  const tokenNames = useMemo(() => state.tokens.map(token => token.name).sort(), [state.tokens])
  const [tokenName, setTokenName] = useState(tokenNames[0] ?? '--dsw-alias-bg-base')
  const token = state.draft.tokens[tokenName] ?? { light: '#ffffff', dark: '#111827' }
  const backdrop = state.draft.backdrop ?? {
    light: { fallbackColor: '#f5f7fb', focusX: 0.5, focusY: 0.5, dim: 0.12, blurPx: 0 },
    dark: { fallbackColor: '#0b1020', focusX: 0.5, focusY: 0.5, dim: 0.28, blurPx: 0 },
  }
  const filteredParts = useMemo(() => {
    const query = partSearch.trim().toLocaleLowerCase()
    if (query === '') return state.parts
    return state.parts.filter((value) => {
      const entry = THEME_PART_GUIDES[value.id]
      return `${entry.label} ${entry.purpose} ${value.id}`.toLocaleLowerCase().includes(query)
    })
  }, [partSearch, state.parts])
  const partEnabled = state.draft.partStyles?.some(rule => rule.part === part) === true
  const partAvailable = isPartPresent(part)
  const supportsSurface = partInfo?.properties.includes('surfaceImage') === true
  const guideParts = state.parts.filter(value => THEME_PART_GUIDES[value.id].filename === guide.filename)

  useEffect(() => {
    if (!state.dirty) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn) }
  }, [state.dirty])

  useEffect(() => {
    if (partInfo?.variants.some(value => value === variant) !== true) setVariant('')
    if (partInfo?.states.some(value => value === partState) !== true) setPartState('')
    if (partInfo?.properties.includes(field) !== true) setField(partInfo?.properties[0] ?? 'background')
  }, [field, partInfo, partState, variant])

  useEffect(() => {
    setLightValue(displayPartValue(rule?.style.light[field]))
    setDarkValue(displayPartValue(rule?.style.dark[field]))
  }, [field, rule])

  useEffect(() => {
    setVisualTemplate(visualItem?.template ?? visualDefinition?.templates[0] ?? 'image-mark')
    setVisualLabel(visualItem?.label ?? '')
    setVisualValue(visualItem?.value ?? '')
  }, [visualDefinition, visualItem])

  const manageDisabled = !state.localManagement || state.busy || state.versionMismatch !== undefined
  return (
    <section className={css.studio} data-dsh-skin-studio data-dsh-theme-part="settings.panel">
      {state.previewing && <button type="button" style={EMERGENCY_EXIT_STYLE} onClick={props.cancelPreview}>退出全页试穿</button>}

      <header className={css.header}>
        <div className={css.headerCopy}>
          <span className={css.eyebrow}>插件 {PLUGIN_VERSION} · 协议 v{SKIN_SCHEMA_VERSION}</span>
          <div className={css.titleLine}>
            <h2 className={css.title}>组件换肤工作室</h2>
            <span className={css.authority} data-local={state.localManagement || undefined}>{state.localManagement ? '本机可管理' : '远程只读'}</span>
          </div>
          <p className={css.subtitle}>安全调整 Token、背景与组件外观，不改变 DSH 组件逻辑。</p>
        </div>
        <span className={css.revision}>revision {state.host?.activationRevision ?? '—'}</span>
      </header>

      {state.versionMismatch !== undefined && <div className={css.error} role="alert">{state.versionMismatch} 请重启 DSH 并刷新页面后再编辑。</div>}
      {state.error !== undefined && <div className={css.error} role="alert">{state.error}</div>}

      <div className={css.primaryTabs} role="tablist" aria-label="换肤工作台">
        <button type="button" role="tab" id="skin-primary-library" aria-controls="skin-library-panel" aria-selected={primaryTab === 'library'} tabIndex={primaryTab === 'library' ? 0 : -1} onKeyDown={handleTabKey} onClick={() => { setPrimaryTab('library') }}>主题库</button>
        <button type="button" role="tab" id="skin-primary-editor" aria-controls="skin-editor-panel" aria-selected={primaryTab === 'editor'} tabIndex={primaryTab === 'editor' ? 0 : -1} onKeyDown={handleTabKey} onClick={() => { setPrimaryTab('editor') }}>编辑皮肤</button>
      </div>

      <section id="skin-library-panel" role="tabpanel" aria-labelledby="skin-primary-library" hidden={primaryTab !== 'library'} className={css.primaryPanel}>
        <div className={css.libraryToolbar}>
          <div className={css.toolbarActions}>
            <Button variant="primary" size="sm" disabled={manageDisabled} onClick={() => { props.beginDraft(); setPrimaryTab('editor') }}>新建皮肤</Button>
            <Button variant="outline" size="sm" disabled={manageDisabled} onClick={() => { importRef.current?.click() }}>导入 .dshskin</Button>
            <Button variant="ghost" size="sm" disabled={manageDisabled} onClick={props.restoreDefault}>恢复 Harness 默认</Button>
          </div>
          <div className={css.schemeSwitch} aria-label="主题封面模式">
            <button type="button" aria-pressed={galleryMode === 'light'} onClick={() => { setGalleryMode('light') }}>Light</button>
            <button type="button" aria-pressed={galleryMode === 'dark'} onClick={() => { setGalleryMode('dark') }}>Dark</button>
          </div>
          <input ref={importRef} className={css.hiddenInput} type="file" accept=".dshskin,application/zip" onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file !== undefined) props.importSkin(file)
            event.currentTarget.value = ''
          }} />
        </div>

        {(state.host?.skins.length ?? 0) === 0
          ? <div className={css.empty}>还没有导入皮肤。选择“新建皮肤”开始创建。</div>
          : <div className={css.libraryGroups}>
              {(['builtin', 'local'] as const).map((source) => {
                const skins = state.host?.skins.filter(skin => skin.source === source) ?? []
                if (skins.length === 0) return null
                return <section key={source} className={css.libraryGroup}>
                  <div className={css.groupHeading}><h3>{source === 'builtin' ? '内置主题' : '本地主题'}</h3><span>{skins.length}</span></div>
                  <div className={css.skinList}>
                    {skins.map((skin) => {
                      const active = skin.fingerprint === state.host?.activeFingerprint
                      const preview = skin.preview?.[galleryMode]
                      return <article key={skin.fingerprint} className={css.skinRow} data-active={active || undefined}>
                        <div className={css.previewFrame}>{preview === undefined ? <span>暂无封面</span> : <img src={preview} alt={`${skin.name} ${galleryMode} 预览`} />}</div>
                        <div className={css.skinSummary}>
                          <div className={css.skinIdentity}>
                            <div><strong>{skin.name}</strong><span>v{skin.version}{skin.author === undefined ? '' : ` · ${skin.author}`}</span></div>
                            {active && <span className={css.activeBadge}>当前</span>}
                          </div>
                          {skin.description !== undefined && <p>{skin.description}</p>}
                          <details className={css.skinDetails}>
                            <summary>查看能力与组件范围</summary>
                            <dl>
                              <div><dt>capabilities</dt><dd>{skin.capabilities.join('、') || '—'}</dd></div>
                              <div><dt>视觉槽位</dt><dd>{skin.visualSlots.join('、') || '—'}</dd></div>
                              <div><dt>parts</dt><dd>{skin.parts.join('、') || '—'}</dd></div>
                              <div><dt>fingerprint</dt><dd><code>{skin.fingerprint}</code></dd></div>
                            </dl>
                          </details>
                        </div>
                        <div className={css.rowActions}>
                          <Button variant="ghost" size="sm" disabled={manageDisabled} onClick={() => { props.beginDraft(skin.fingerprint); setPrimaryTab('editor') }}>编辑与试穿</Button>
                          {!active && <Button variant="primary" size="sm" disabled={manageDisabled} onClick={() => { props.activate(skin.fingerprint) }}>激活</Button>}
                          {!active && skin.source === 'local' && skin.fingerprint !== state.host?.previousConfirmed && <Button variant="ghost" size="sm" disabled={manageDisabled} onClick={() => { props.deleteSkin(skin.fingerprint) }}>删除</Button>}
                        </div>
                      </article>
                    })}
                  </div>
                </section>
              })}
            </div>}
      </section>

      <section id="skin-editor-panel" role="tabpanel" aria-labelledby="skin-primary-editor" hidden={primaryTab !== 'editor'} className={css.primaryPanel}>
        <div className={css.editorToolbar} aria-disabled={manageDisabled || undefined}>
          <label className={css.draftName}>名称<Input value={state.draftName} disabled={manageDisabled} onChange={event => { props.updateDraftName(event.currentTarget.value) }} /></label>
          <div className={css.toolbarActions}>
            <Button variant="outline" size="sm" onClick={() => { props.setColorScheme('light') }}>Light</Button>
            <Button variant="outline" size="sm" onClick={() => { props.setColorScheme('dark') }}>Dark</Button>
            <Button variant="ghost" size="sm" disabled={!state.canUndo} onClick={props.undo}>撤销</Button>
            <Button variant="ghost" size="sm" disabled={!state.canRedo} onClick={props.redo}>重做</Button>
            <Button variant="primary" size="sm" disabled={manageDisabled} onClick={props.saveDraft}>保存到 Host</Button>
            <Button variant="outline" size="sm" disabled={manageDisabled} onClick={props.exportDraft}>导出 .dshskin</Button>
            {state.previewing ? <Button variant="ghost" size="sm" onClick={props.cancelPreview}>取消试穿</Button> : <Button variant="ghost" size="sm" disabled={manageDisabled} onClick={props.resumePreview}>全页试穿</Button>}
          </div>
          <span className={css.dirtyState} title={state.changes.join('、')}>{state.dirty ? `未保存 · ${state.changes.length} 项修改` : '已保存'}</span>
        </div>

        <div className={css.editorTabs} role="tablist" aria-label="皮肤编辑分类">
          {([['components', '组件'], ['tokens', '色彩 Token'], ['backdrop', '背景']] as const).map(([id, label]) => <button key={id} type="button" role="tab" id={`skin-editor-${id}`} aria-controls={`skin-editor-${id}-panel`} aria-selected={editorTab === id} tabIndex={editorTab === id ? 0 : -1} onKeyDown={handleTabKey} onClick={() => { setEditorTab(id) }}>{label}</button>)}
        </div>

        <section id="skin-editor-components-panel" role="tabpanel" aria-labelledby="skin-editor-components" hidden={editorTab !== 'components'} className={css.editorContent}>
          <div className={css.componentWorkspace}>
            <details className={css.partNavigation} open>
              <summary>{guide.label}<span>{part}</span></summary>
              <div className={css.partNavigationBody}>
                <Input aria-label="搜索组件" value={partSearch} disabled={!state.localManagement} placeholder="搜索中文名称或 Part ID" onChange={event => { setPartSearch(event.currentTarget.value) }} />
                <nav className={css.partCatalog} aria-label="Theme Parts v2 组件目录">
                  {GUIDE_GROUPS.map((group) => {
                    const parts = filteredParts.filter(value => THEME_PART_GUIDES[value.id].group === group)
                    if (parts.length === 0) return null
                    return <section key={group} className={css.partGroup}>
                      <h3>{group}</h3>
                      {parts.map((value) => {
                        const entry = THEME_PART_GUIDES[value.id]
                        const styled = state.draft.partStyles?.some(rule => rule.part === value.id) === true
                        const available = isPartPresent(value.id)
                        return <button key={value.id} type="button" data-selected={part === value.id || undefined} onClick={() => { setPart(value.id) }}>
                          <span>{entry.label}</span><code>{value.id}</code><small>{styled ? '已换肤' : 'DSH 默认'} · {available ? '当前页可见' : '当前页未出现'}</small>
                        </button>
                      })}
                    </section>
                  })}
                  {filteredParts.length === 0 && <p className={css.noResults}>没有匹配的组件。</p>}
                </nav>
              </div>
            </details>

            <div className={css.componentDetail}>
              <div className={css.componentHeading}>
                <div data-component-title><span>{guide.group}</span><h3>{guide.label}</h3><code>{part}</code></div>
                <div className={css.toolbarActions}>
                  <span className={css.statusBadge} data-part-availability data-available={partAvailable || undefined}>{partAvailable ? '当前页可见' : '当前页未出现'}</span>
                  <Button variant="outline" size="sm" disabled={!partAvailable} onClick={() => { locatePart(part) }}>在当前页面定位</Button>
                </div>
              </div>
              <p className={css.purpose}>{guide.purpose}</p>
              {!partAvailable && <p className={css.notice}>当前页面暂无对应锚点；仍可编辑并保存，进入对应页面后自动生效。</p>}

              <figure className={css.guideFigure}>
                <div className={css.guideCanvas}>
                  <img data-part-guide src={`/api/dsh-skin/guides/${guide.filename}`} alt={`DSH 实景导览：${guide.label}`} />
                  {guideParts.map((candidate) => {
                    const hotspot = THEME_PART_GUIDES[candidate.id]
                    return <button key={candidate.id} type="button" data-part-hotspot={candidate.id} className={css.guideHotspot} aria-label={`选择 ${hotspot.label}`} title={`${hotspot.label} · ${candidate.id}`} style={{ left: `${hotspot.highlight.x * 100}%`, top: `${hotspot.highlight.y * 100}%`, width: `${hotspot.highlight.width * 100}%`, height: `${hotspot.highlight.height * 100}%` }} onClick={() => { setPart(candidate.id) }} />
                  })}
                  <span data-part-highlight aria-hidden="true" className={css.guideHighlight} style={{ left: `${guide.highlight.x * 100}%`, top: `${guide.highlight.y * 100}%`, width: `${guide.highlight.width * 100}%`, height: `${guide.highlight.height * 100}%` }} />
                </div>
                <figcaption>点击高亮区域选择组件 · 当前选中：{guide.label}</figcaption>
              </figure>

              <div className={css.componentTabs} role="tablist" aria-label="组件编辑分类">
                {([['appearance', '外观'], ['visuals', '图片与图标'], ['state', '状态']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={componentTab === id} tabIndex={componentTab === id ? 0 : -1} onKeyDown={handleTabKey} onClick={() => { setComponentTab(id) }}>{label}</button>)}
              </div>

              <section hidden={componentTab !== 'appearance'} className={css.componentEditorPanel}>
                <div className={css.propertyGrid}>
                  <label className={css.fieldLabel}>外观属性<select value={field} disabled={manageDisabled} onChange={event => { setField(event.currentTarget.value as keyof ThemePartStyle) }}>{EDITABLE_PART_FIELDS.filter(value => partInfo?.properties.includes(value) === true).map(value => <option key={value} value={value}>{appearanceLabel(value)}</option>)}</select></label>
                </div>
                <AppearanceFields field={field} disabled={manageDisabled} light={lightValue} dark={darkValue} onLight={setLightValue} onDark={setDarkValue} />
                <div className={css.toolbarActions}>
                  <Button variant="primary" size="sm" disabled={manageDisabled} onClick={() => { props.upsertPartRule(part, variant, partState, field, lightValue, darkValue) }}>应用外观</Button>
                  <Button variant="outline" size="sm" disabled={manageDisabled} onClick={() => { props.resetPartProperty(part, variant, partState, field) }}>重置当前属性</Button>
                </div>
              </section>

              <section hidden={componentTab !== 'visuals'} className={css.componentEditorPanel}>
                {supportsSurface && <section className={css.assetSection}>
                  <div className={css.sectionHeading}><div><h4>组件表面图</h4><p>受控背景图不会改变组件结构或交互。</p></div><span>推荐：1600 × 900 px</span></div>
                  <div className={css.assetCards}>{(['light', 'dark'] as const).map(mode => <ImageAssetEditor key={mode} mode={mode} kind="组件表面" assetUrl={rule?.style[mode].surfaceImage?.assetUrl} fit={rule?.style[mode].surfaceImage?.fit} positionX={rule?.style[mode].surfaceImage?.positionX} positionY={rule?.style[mode].surfaceImage?.positionY} disabled={manageDisabled} onFile={file => { props.updatePartSurfaceImage(part, variant, partState, mode, file) }} onRemove={() => { props.removePartSurfaceImage(part, variant, partState, mode) }} onSetting={(nextField, value) => { props.updatePartSurfaceSettings(part, variant, partState, mode, nextField, value) }} />)}</div>
                </section>}

                {visualDefinition !== undefined && visualSlot !== undefined && <section className={css.assetSection}>
                  <div className={css.sectionHeading}><div><h4>{visualDefinition.label}</h4><p>{visualDefinition.purpose}。功能性图标不可替换。</p></div><span>推荐尺寸：{visualDefinition.recommendedSize}</span></div>
                  <div className={css.visualConfigurator}>
                    <label className={css.fieldLabel}>固定模板<select value={visualTemplate} disabled={manageDisabled} onChange={event => { setVisualTemplate(event.currentTarget.value as VisualTemplateKind) }}>{visualDefinition.templates.map(value => <option key={value} value={value}>{visualTemplateLabel(value)}</option>)}</select></label>
                    {visualTemplate !== 'image-mark' && <label className={css.fieldLabel}>显示文字<Input value={visualLabel} disabled={manageDisabled} onChange={event => { setVisualLabel(event.currentTarget.value) }} /></label>}
                    {visualTemplate === 'status-chip' && <label className={css.fieldLabel}>状态值<Input value={visualValue} disabled={manageDisabled} onChange={event => { setVisualValue(event.currentTarget.value) }} /></label>}
                    <Button variant="primary" size="sm" disabled={manageDisabled} onClick={() => { props.configureVisual(visualSlot, visualTemplate, visualLabel, visualValue) }}>{visualItem === undefined ? '启用小组件' : '应用模板设置'}</Button>
                    {visualItem !== undefined && <Button variant="ghost" size="sm" disabled={manageDisabled} onClick={() => { props.removeVisual(visualSlot) }}>恢复该槽位默认</Button>}
                  </div>
                  {visualItem !== undefined && <div className={css.modeFields}>{(['light', 'dark'] as const).map(mode => <fieldset key={mode} className={css.visualColors} disabled={manageDisabled}><legend>{mode === 'light' ? 'Light' : 'Dark'} 小组件颜色</legend>{visualTemplate !== 'image-mark' && <label>文字<Input value={displayColor(visualItem.modes[mode].foreground ?? '#1f2937')} onChange={event => { props.updateVisualMode(visualSlot, mode, 'foreground', event.currentTarget.value) }} /></label>}<label>表面<Input value={displayColor(visualItem.modes[mode].background ?? '#ffffffcc')} onChange={event => { props.updateVisualMode(visualSlot, mode, 'background', event.currentTarget.value) }} /></label></fieldset>)}</div>}
                  <div className={css.assetCards}>{(['light', 'dark'] as const).map(mode => <ImageAssetEditor key={mode} mode={mode} kind="装饰素材" marker="visual" assetUrl={visualItem?.modes[mode].assetUrl} fit={visualItem?.modes[mode].fit} positionX={visualItem?.modes[mode].positionX} positionY={visualItem?.modes[mode].positionY} disabled={manageDisabled || visualItem === undefined} onFile={file => { props.updateVisualImage(visualSlot, mode, file) }} onRemove={() => { props.removeVisualImage(visualSlot, mode) }} onSetting={(nextField, value) => { props.updateVisualMode(visualSlot, mode, nextField, value) }} />)}</div>
                </section>}

                {!supportsSurface && visualDefinition === undefined && <div className={css.unsupported} data-visual-unsupported><strong>此组件不开放图片或装饰图标</strong><p>该区域包含功能性图标或没有安全的视觉槽位；仍可在“外观”中调整允许的颜色、边框与圆角。</p></div>}
              </section>

              <section hidden={componentTab !== 'state'} className={css.componentEditorPanel}>
                <div className={css.propertyGrid}>
                  <label className={css.fieldLabel}>Variant<select value={variant} disabled={manageDisabled} onChange={event => { setVariant(event.currentTarget.value) }}><option value="">默认</option>{partInfo?.variants.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label className={css.fieldLabel}>State<select value={partState} disabled={manageDisabled} onChange={event => { setPartState(event.currentTarget.value) }}><option value="">默认</option>{partInfo?.states.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                </div>
                <div className={css.stateSummary}><span>当前规则</span><strong>{partEnabled ? '已启用组件换肤' : '使用 DSH 默认'}</strong><code>{variant || 'default'} · {partState || 'base'}</code></div>
                <div className={css.toolbarActions}><Button variant="ghost" size="sm" disabled={manageDisabled} onClick={() => { props.setPartEnabled(part, !partEnabled) }}>{partEnabled ? '恢复 DSH 默认' : '启用组件换肤'}</Button></div>
              </section>

              <section className={css.previewComparison} aria-label="组件效果对照">
                <h4>效果对照</h4>
                <div className={css.componentPreviewGrid}>
                  <div><span>DSH 原始效果</span><div>{guide.label}</div></div>
                  {(['light', 'dark'] as const).map(mode => <div key={mode} data-dsh-theme-preview-mode={mode}><span>{mode === 'light' ? 'Light' : 'Dark'} 修改后</span><div data-dsh-theme-part={part} data-dsh-theme-variant={variant || undefined} data-dsh-theme-state={partState || undefined}>{guide.label}</div></div>)}
                </div>
              </section>

              <details className={css.previewDetails}>
                <summary>打开综合组件预览</summary>
                <div className={css.modePreviewGrid}><ModePreview title="Light" mode="light" layer={state.draft} /><ModePreview title="Dark" mode="dark" layer={state.draft} /></div>
                <div className={css.primitives}>
                  <Button variant="primary">Primary Button</Button><Button variant="ghost">Ghost Button</Button><Button variant="outline" disabled>Disabled</Button><Input placeholder="Input control" />
                  <Menu open={menuOpen} anchor={<Button variant="toolbar" onClick={() => { setMenuOpen(value => !value) }}>Menu 状态</Button>} items={[{ id: 'selected', label: 'Selected item' }, { id: 'disabled', label: 'Disabled item', disabled: true }]} selectedId="selected" onSelect={() => { setMenuOpen(false) }} onClose={() => { setMenuOpen(false) }} />
                  <Button variant="outline" onClick={() => { setDialogOpen(true) }}>Dialog 预览</Button>
                </div>
              </details>
            </div>
          </div>
        </section>

        <section id="skin-editor-tokens-panel" role="tabpanel" aria-labelledby="skin-editor-tokens" hidden={editorTab !== 'tokens'} className={css.editorContent}>
          <div className={css.scrollPanel}>
            <div className={css.panelHeading}><h3>色彩 Token</h3><p>同时维护 Light 与 Dark 值，确保模式切换完整。</p></div>
            <label className={css.fieldLabel}>Token<select value={tokenName} disabled={!state.localManagement} onChange={event => { setTokenName(event.currentTarget.value) }}>{tokenNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
            <p className={css.purpose}>{state.tokens.find(value => value.name === tokenName)?.description ?? '语义色彩变量'}</p>
            <ModeFields disabled={manageDisabled} light={token.light} dark={token.dark} onLight={value => { props.updateToken(tokenName, 'light', value) }} onDark={value => { props.updateToken(tokenName, 'dark', value) }} />
          </div>
        </section>

        <section id="skin-editor-backdrop-panel" role="tabpanel" aria-labelledby="skin-editor-backdrop" hidden={editorTab !== 'backdrop'} className={css.editorContent}>
          <div className={css.scrollPanel}>
            <div className={css.panelHeading}><h3>背景焦点与遮罩</h3><p>上传本地安全素材，并分别调整两种模式的焦点和可读性遮罩。</p></div>
            <div className={css.assetFields}>{(['light', 'dark'] as const).map(mode => <label key={mode} className={css.fieldLabel}>{mode === 'light' ? 'Light' : 'Dark'} 背景 / 卡片封面<input type="file" accept="image/png,image/jpeg,image/webp" disabled={manageDisabled} onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file !== undefined) props.updateBackdropImage(mode, file)
              event.currentTarget.value = ''
            }} /></label>)}</div>
            <BackdropFields mode="light" values={backdrop.light} disabled={manageDisabled} update={(nextField, value) => { props.updateBackdrop('light', nextField, value) }} />
            <BackdropFields mode="dark" values={backdrop.dark} disabled={manageDisabled} update={(nextField, value) => { props.updateBackdrop('dark', nextField, value) }} />
          </div>
        </section>
      </section>

      <Modal open={dialogOpen} title="组件皮肤 Dialog" onClose={() => { setDialogOpen(false) }} footer={<Button variant="primary" onClick={() => { setDialogOpen(false) }}>完成</Button>}>这里使用 Harness 真实 Dialog Surface 与 Button Part。</Modal>
    </section>
  )
}

const EMERGENCY_EXIT_STYLE: CSSProperties = {
  position: 'fixed', top: 12, right: 12, zIndex: 2147483647,
  minHeight: 40, padding: '0 16px', border: '2px solid #ffffff', borderRadius: 999,
  color: '#ffffff', background: '#b42318', boxShadow: '0 6px 24px #00000055',
  font: '600 14px/1 system-ui, sans-serif', cursor: 'pointer', pointerEvents: 'auto',
}

function handleTabKey(event: KeyboardEvent<HTMLButtonElement>): void {
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
  const current = tabs.indexOf(event.currentTarget)
  let next: number
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length
  else return
  const target = tabs[next]
  if (target === undefined) return
  event.preventDefault()
  target.click()
  target.focus()
}

function isPartPresent(part: ThemePartId): boolean {
  if (typeof document === 'undefined') return false
  return Array.from(document.querySelectorAll(`[data-dsh-theme-part="${part}"]`))
    .some(element => element.closest('[data-dsh-theme-preview-mode], [data-dsh-skin-studio]') === null)
}

function locatePart(part: ThemePartId): void {
  const target = Array.from(document.querySelectorAll<HTMLElement>(`[data-dsh-theme-part="${part}"]`))
    .find(element => element.closest('[data-dsh-theme-preview-mode], [data-dsh-skin-studio]') === null)
  if (target === undefined) return
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'center' })
  target.dataset.dshSkinLocating = 'true'
  window.setTimeout(() => { delete target.dataset.dshSkinLocating }, 1800)
}

function AppearanceFields({ field, disabled, light, dark, onLight, onDark }: {
  field: keyof ThemePartStyle; disabled: boolean; light: string; dark: string
  onLight: (value: string) => void; onDark: (value: string) => void
}): ReactNode {
  const numeric = numericRange(field)
  if (numeric !== undefined) return <div className={css.modeFields}>{([['Light', light, onLight], ['Dark', dark, onDark]] as const).map(([label, value, update]) => <label key={label} className={css.fieldLabel}>{label}<span className={css.rangeField}><input type="range" min={numeric.min} max={numeric.max} step={numeric.step} value={value === '' ? numeric.fallback : value} disabled={disabled} onChange={event => { update(event.currentTarget.value) }} /><Input value={value} disabled={disabled} onChange={event => { update(event.currentTarget.value) }} /></span></label>)}</div>
  if (field === 'borderStyle') return <SelectModes disabled={disabled} light={light} dark={dark} values={['none', 'solid', 'dashed', 'dotted']} onLight={onLight} onDark={onDark} />
  if (field === 'fontFamily') return <SelectModes disabled={disabled} light={light} dark={dark} values={['system-sans', 'rounded', 'serif', 'monospace']} onLight={onLight} onDark={onDark} />
  if (field === 'shadows') return <SelectModes disabled={disabled} light={light} dark={dark} values={['[]', '[{"xPx":0,"yPx":8,"blurPx":24,"spreadPx":0,"color":"#0f172a1f"}]', '[{"xPx":0,"yPx":14,"blurPx":36,"spreadPx":0,"color":"#0f172a33"}]']} labels={['无阴影', '轻柔阴影', '强调阴影']} onLight={onLight} onDark={onDark} />
  const color = field === 'foreground' || field === 'background' || field === 'borderColor'
  return <div className={css.modeFields}>{([['Light', light, onLight], ['Dark', dark, onDark]] as const).map(([label, value, update]) => <label key={label} className={css.fieldLabel}>{label}<span className={css.valueField}>{color && /^#[a-f0-9]{6}$/iu.test(value) && <input type="color" aria-label={`${label} 取色`} value={value} disabled={disabled} onChange={event => { update(event.currentTarget.value) }} />}<Input value={value} disabled={disabled} onChange={event => { update(event.currentTarget.value) }} /></span></label>)}</div>
}

function SelectModes({ disabled, light, dark, values, labels = values, onLight, onDark }: {
  disabled: boolean; light: string; dark: string; values: readonly string[]; labels?: readonly string[]
  onLight: (value: string) => void; onDark: (value: string) => void
}): ReactNode {
  return <div className={css.modeFields}>{([['Light', light, onLight], ['Dark', dark, onDark]] as const).map(([mode, value, update]) => <label key={mode} className={css.fieldLabel}>{mode}<select value={value} disabled={disabled} onChange={event => { update(event.currentTarget.value) }}>{values.map((option, index) => <option key={option} value={option}>{labels[index] ?? option}</option>)}</select></label>)}</div>
}

function ImageAssetEditor({ mode, kind, marker, assetUrl, fit: configuredFit, positionX: configuredX, positionY: configuredY, disabled, onFile, onRemove, onSetting }: {
  mode: 'light' | 'dark'; kind: '组件表面' | '装饰素材'; marker?: 'visual'; assetUrl: string | undefined
  fit: 'cover' | 'contain' | undefined; positionX: number | undefined; positionY: number | undefined; disabled: boolean
  onFile: (file: File) => void; onRemove: () => void
  onSetting: (field: 'fit' | 'positionX' | 'positionY', value: string) => void
}): ReactNode {
  const fit = configuredFit ?? 'contain'
  const positionX = configuredX ?? 0.5
  const positionY = configuredY ?? 0.5
  const label = mode === 'light' ? 'Light' : 'Dark'
  const accept = (files: FileList | null): void => { const file = files?.[0]; if (file !== undefined) onFile(file) }
  return <article className={css.assetCard}>
    <header><strong>{label}</strong><span>{assetUrl === undefined ? '未设置' : '已设置'}</span></header>
    <div className={css.assetPreview}>{assetUrl === undefined ? <p>选择本地 PNG、JPEG 或 WebP</p> : <img {...(marker === undefined ? { 'data-current-surface': mode } : { 'data-current-visual': mode })} src={assetUrl} alt={`${label} ${kind}预览`} style={{ objectFit: fit, objectPosition: `${positionX * 100}% ${positionY * 100}%` }} />}</div>
    <label className={css.dropZone} onDragOver={event => { event.preventDefault() }} onDrop={event => { event.preventDefault(); if (!disabled) accept(event.dataTransfer.files) }}>{assetUrl === undefined ? '拖放或选择素材' : '替换素材'}<input aria-label={`${label} ${kind}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => { accept(event.currentTarget.files); event.currentTarget.value = '' }} /></label>
    {assetUrl !== undefined && <div className={css.assetControls}>
      <label>适配<select value={fit} disabled={disabled} onChange={event => { onSetting('fit', event.currentTarget.value) }}><option value="cover">cover</option><option value="contain">contain</option></select></label>
      <label>焦点 X<input type="range" min="0" max="1" step="0.01" value={positionX} disabled={disabled} onChange={event => { onSetting('positionX', event.currentTarget.value) }} /></label>
      <label>焦点 Y<input type="range" min="0" max="1" step="0.01" value={positionY} disabled={disabled} onChange={event => { onSetting('positionY', event.currentTarget.value) }} /></label>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>删除素材</Button>
    </div>}
  </article>
}

function numericRange(field: keyof ThemePartStyle): { min: number; max: number; step: number; fallback: number } | undefined {
  if (field === 'opacity') return { min: 0, max: 1, step: 0.01, fallback: 1 }
  if (field === 'backdropBlurPx') return { min: 0, max: 40, step: 1, fallback: 0 }
  if (field === 'borderRadiusPx') return { min: 0, max: 48, step: 1, fallback: 12 }
  if (field === 'borderWidthPx') return { min: 0, max: 8, step: 1, fallback: 1 }
  if (field === 'paddingBlockPx' || field === 'paddingInlinePx' || field === 'gapPx') return { min: 0, max: 48, step: 1, fallback: 8 }
  if (field === 'fontSizePx') return { min: 10, max: 36, step: 1, fallback: 14 }
  if (field === 'fontWeight') return { min: 400, max: 700, step: 100, fallback: 500 }
  if (field === 'lineHeight') return { min: 1, max: 2, step: 0.05, fallback: 1.4 }
  if (field === 'letterSpacingPx') return { min: -2, max: 8, step: 0.1, fallback: 0 }
  if (field === 'transitionDurationMs') return { min: 0, max: 600, step: 25, fallback: 150 }
  return undefined
}

function appearanceLabel(field: keyof ThemePartStyle): string {
  return ({ foreground: '文字颜色', background: '背景颜色', borderColor: '边框颜色', borderWidthPx: '边框宽度', borderStyle: '边框样式', borderRadiusPx: '圆角', shadows: '阴影', opacity: '透明度', backdropBlurPx: '背景模糊', paddingBlockPx: '纵向内边距', paddingInlinePx: '横向内边距', gapPx: '间距', fontFamily: '字体', fontSizePx: '字号', fontWeight: '字重', lineHeight: '行高', letterSpacingPx: '字距', transitionDurationMs: '过渡时长', surfaceImage: '表面图' } as const)[field]
}

function visualTemplateLabel(template: VisualTemplateKind): string {
  if (template === 'compact-brand') return '紧凑品牌'
  if (template === 'status-chip') return '状态标签'
  return '图片标志'
}

function ModeFields({ disabled, light, dark, onLight, onDark }: { disabled: boolean; light: string; dark: string; onLight: (value: string) => void; onDark: (value: string) => void }): ReactNode {
  return <div className={css.modeFields}><label className={css.fieldLabel}>Light<Input value={light} disabled={disabled} onChange={event => { onLight(event.currentTarget.value) }} /></label><label className={css.fieldLabel}>Dark<Input value={dark} disabled={disabled} onChange={event => { onDark(event.currentTarget.value) }} /></label></div>
}

function BackdropFields({ mode, values, disabled, update }: {
  mode: 'light' | 'dark'; values: { fallbackColor: ThemeColorValue; focusX: number; focusY: number; dim: number; blurPx: number }; disabled: boolean
  update: (field: 'fallbackColor' | 'focusX' | 'focusY' | 'dim' | 'blurPx', value: string) => void
}): ReactNode {
  return <fieldset className={css.backdropFields} disabled={disabled}>
    <legend>{mode === 'light' ? 'Light' : 'Dark'}</legend>
    <label>回退色<Input value={displayColor(values.fallbackColor)} onChange={event => { update('fallbackColor', event.currentTarget.value) }} /></label>
    <label>焦点 X<input type="range" min="0" max="1" step="0.01" value={values.focusX} onChange={event => { update('focusX', event.currentTarget.value) }} /></label>
    <label>焦点 Y<input type="range" min="0" max="1" step="0.01" value={values.focusY} onChange={event => { update('focusY', event.currentTarget.value) }} /></label>
    <label>暗化<input type="range" min="0" max="1" step="0.01" value={values.dim} onChange={event => { update('dim', event.currentTarget.value) }} /></label>
    <label>模糊<input type="range" min="0" max="30" step="1" value={values.blurPx} onChange={event => { update('blurPx', event.currentTarget.value) }} /></label>
  </fieldset>
}

function ModePreview({ title, mode, layer }: { title: string; mode: 'light' | 'dark'; layer: ThemeLayerV2 }): ReactNode {
  const variables: CSSProperties & Record<string, string> = {}
  for (const [name, value] of Object.entries(layer.tokens)) if (value !== undefined) variables[name] = value[mode]
  return <div className={css.modePreview} style={variables} data-mode={mode} data-dsh-theme-preview-mode={mode}>
    <span>{title}</span><div className={css.sampleSidebar} data-dsh-theme-part="shell.sidebar">Sidebar</div>
    <div className={css.sampleMain} data-dsh-theme-part="shell.main"><div data-dsh-theme-part="conversation.message" data-dsh-theme-variant="assistant">Assistant message</div><div data-dsh-theme-part="conversation.message" data-dsh-theme-variant="user">User message</div></div>
  </div>
}

function displayColor(value: ThemeColorValue): string { return typeof value === 'string' ? value : `$token:${value.token}` }

function displayPartValue(value: ThemePartStyle[keyof ThemePartStyle] | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'object') {
    if ('token' in value) return `$token:${value.token}`
    return JSON.stringify(value)
  }
  return String(value)
}
