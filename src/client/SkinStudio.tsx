import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkinStudioInjected, StudioSnapshot } from './contracts.ts'
import type { ThemeColorValue, ThemeLayerV2, ThemePartId, ThemePartStyle } from '../shared/contracts.ts'
import { THEME_PART_GUIDES, type PartGuideGroup } from '../shared/part-guides.ts'
import css from './SkinStudio.module.css'

type SkinStudioProps = Omit<SkinStudioInjected, 'hooks'> & {
  useStudio<T>(selector: (state: StudioSnapshot) => T, equal?: (left: T, right: T) => boolean): T
}

type PrimaryTab = 'library' | 'editor'
type EditorTab = 'components' | 'tokens' | 'backdrop'

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

  const partInfo = state.parts.find(value => value.id === part)
  const guide = THEME_PART_GUIDES[part]
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
    const rule = state.draft.partStyles?.find(value => value.part === part
      && (value.variant ?? '') === variant
      && (value.state ?? '') === partState)
    setLightValue(displayPartValue(rule?.style.light[field]))
    setDarkValue(displayPartValue(rule?.style.dark[field]))
  }, [field, part, partState, state.draft.partStyles, variant])

  const manageDisabled = !state.localManagement || state.busy
  return (
    <section className={css.studio} data-dsh-theme-part="settings.panel">
      {state.previewing && <button type="button" style={EMERGENCY_EXIT_STYLE} onClick={props.cancelPreview}>退出全页试穿</button>}

      <header className={css.header}>
        <div className={css.headerCopy}>
          <span className={css.eyebrow}>DSH SKIN STUDIO</span>
          <div className={css.titleLine}>
            <h2 className={css.title}>组件换肤工作室</h2>
            <span className={css.authority} data-local={state.localManagement || undefined}>{state.localManagement ? '本机可管理' : '远程只读'}</span>
          </div>
          <p className={css.subtitle}>安全调整 Token、背景与组件外观，不改变 DSH 组件逻辑。</p>
        </div>
        <span className={css.revision}>revision {state.host?.activationRevision ?? '—'}</span>
      </header>

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
                              <div><dt>placements</dt><dd>{skin.experience?.placements.join('、') || '—'}</dd></div>
                              <div><dt>parts</dt><dd>{skin.parts.join('、') || '—'}</dd></div>
                              <div><dt>fingerprint</dt><dd><code>{skin.fingerprint}</code></dd></div>
                            </dl>
                          </details>
                        </div>
                        <div className={css.rowActions}>
                          <Button variant="ghost" size="sm" disabled={!state.localManagement || state.busy} onClick={() => { props.beginDraft(skin.fingerprint); setPrimaryTab('editor') }}>编辑与试穿</Button>
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
        <div className={css.editorToolbar} aria-disabled={!state.localManagement || undefined}>
          <label className={css.draftName}>名称<Input value={state.draftName} disabled={!state.localManagement} onChange={event => { props.updateDraftName(event.currentTarget.value) }} /></label>
          <div className={css.toolbarActions}>
            <Button variant="outline" size="sm" onClick={() => { props.setColorScheme('light') }}>Light</Button>
            <Button variant="outline" size="sm" onClick={() => { props.setColorScheme('dark') }}>Dark</Button>
            <Button variant="ghost" size="sm" disabled={!state.canUndo} onClick={props.undo}>撤销</Button>
            <Button variant="ghost" size="sm" disabled={!state.canRedo} onClick={props.redo}>重做</Button>
            <Button variant="primary" size="sm" disabled={manageDisabled} onClick={props.saveDraft}>保存到 Host</Button>
            <Button variant="outline" size="sm" disabled={manageDisabled} onClick={props.exportDraft}>导出 .dshskin</Button>
            {state.previewing ? <Button variant="ghost" size="sm" onClick={props.cancelPreview}>取消试穿</Button> : <Button variant="ghost" size="sm" disabled title="从主题库选择“编辑与试穿”后开启">全页试穿</Button>}
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
                <div><span>{guide.group}</span><h3>{guide.label}</h3><code>{part}</code></div>
                <span className={css.statusBadge} data-part-availability data-available={partAvailable || undefined}>{partAvailable ? '当前页可见' : '当前页未出现'}</span>
              </div>
              <p className={css.purpose}>{guide.purpose}</p>
              {!partAvailable && <p className={css.notice}>当前页面暂无对应锚点；仍可编辑并保存，进入对应页面后自动生效。</p>}

              <figure className={css.guideFigure}>
                <div className={css.guideCanvas}>
                  <img data-part-guide src={`/api/dsh-skin/guides/${guide.filename}`} alt={`DSH 实景导览：${guide.label}`} />
                  <span data-part-highlight aria-hidden="true" className={css.guideHighlight} style={{ left: `${guide.highlight.x * 100}%`, top: `${guide.highlight.y * 100}%`, width: `${guide.highlight.width * 100}%`, height: `${guide.highlight.height * 100}%` }} />
                </div>
                <figcaption>真实 DSH 页面位置 · 高亮区域为当前 Part</figcaption>
              </figure>

              <div className={css.propertyGrid}>
                <label className={css.fieldLabel}>Variant<select value={variant} disabled={!state.localManagement} onChange={event => { setVariant(event.currentTarget.value) }}><option value="">默认</option>{partInfo?.variants.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                <label className={css.fieldLabel}>State<select value={partState} disabled={!state.localManagement} onChange={event => { setPartState(event.currentTarget.value) }}><option value="">默认</option>{partInfo?.states.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                <label className={css.fieldLabel}>属性<select value={field} disabled={!state.localManagement} onChange={event => { setField(event.currentTarget.value as keyof ThemePartStyle) }}>{EDITABLE_PART_FIELDS.filter(value => partInfo?.properties.includes(value) === true).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              </div>
              <ModeFields disabled={!state.localManagement} light={lightValue} dark={darkValue} onLight={setLightValue} onDark={setDarkValue} />
              <div className={css.toolbarActions}>
                <Button variant="primary" size="sm" disabled={manageDisabled} onClick={() => { props.upsertPartRule(part, variant, partState, field, lightValue, darkValue) }}>应用完整规则</Button>
                <Button variant="outline" size="sm" disabled={manageDisabled} onClick={() => { props.resetPartProperty(part, variant, partState, field) }}>重置当前属性</Button>
                <Button variant="ghost" size="sm" disabled={manageDisabled} onClick={() => { props.setPartEnabled(part, !partEnabled) }}>{partEnabled ? '恢复 DSH 默认' : '启用组件换肤'}</Button>
              </div>

              <div className={css.assetFields}>
                {(['light', 'dark'] as const).map(mode => <label key={mode} className={css.fieldLabel}>{mode === 'light' ? 'Light' : 'Dark'} 组件背景素材<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!state.localManagement || partInfo?.properties.includes('surfaceImage') !== true} onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file !== undefined) props.updatePartSurfaceImage(part, variant, partState, mode, file)
                  event.currentTarget.value = ''
                }} /></label>)}
              </div>

              <div className={css.componentPreviewGrid}>
                {(['light', 'dark'] as const).map(mode => <div key={mode} data-dsh-theme-preview-mode={mode}><span>{mode === 'light' ? 'Light' : 'Dark'} 局部预览</span><div data-dsh-theme-part={part} data-dsh-theme-variant={variant || undefined} data-dsh-theme-state={partState || undefined}>{guide.label}</div></div>)}
              </div>

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
            <ModeFields disabled={!state.localManagement} light={token.light} dark={token.dark} onLight={value => { props.updateToken(tokenName, 'light', value) }} onDark={value => { props.updateToken(tokenName, 'dark', value) }} />
          </div>
        </section>

        <section id="skin-editor-backdrop-panel" role="tabpanel" aria-labelledby="skin-editor-backdrop" hidden={editorTab !== 'backdrop'} className={css.editorContent}>
          <div className={css.scrollPanel}>
            <div className={css.panelHeading}><h3>背景焦点与遮罩</h3><p>上传本地安全素材，并分别调整两种模式的焦点和可读性遮罩。</p></div>
            <div className={css.assetFields}>{(['light', 'dark'] as const).map(mode => <label key={mode} className={css.fieldLabel}>{mode === 'light' ? 'Light' : 'Dark'} 背景 / 卡片封面<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!state.localManagement} onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file !== undefined) props.updateBackdropImage(mode, file)
              event.currentTarget.value = ''
            }} /></label>)}</div>
            <BackdropFields mode="light" values={backdrop.light} disabled={!state.localManagement} update={(nextField, value) => { props.updateBackdrop('light', nextField, value) }} />
            <BackdropFields mode="dark" values={backdrop.dark} disabled={!state.localManagement} update={(nextField, value) => { props.updateBackdrop('dark', nextField, value) }} />
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
    .some(element => element.closest('[data-dsh-theme-preview-mode]') === null)
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
