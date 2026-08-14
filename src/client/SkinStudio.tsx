import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkinStudioInjected, StudioSnapshot } from './contracts.ts'
import type { ThemeColorValue, ThemeLayerDefinition, ThemePartStyle } from '../shared/contracts.ts'
import css from './SkinStudio.module.css'

type SkinStudioProps = Omit<SkinStudioInjected, 'hooks'> & {
  useStudio<T>(selector: (state: StudioSnapshot) => T, equal?: (left: T, right: T) => boolean): T
}

const EDITABLE_PART_FIELDS: readonly (keyof ThemePartStyle)[] = [
  'foreground', 'background', 'borderColor', 'borderWidthPx', 'borderRadiusPx',
  'borderStyle', 'shadows', 'opacity', 'backdropBlurPx', 'paddingBlockPx',
  'paddingInlinePx', 'gapPx', 'fontFamily', 'fontSizePx', 'fontWeight',
  'lineHeight', 'letterSpacingPx', 'transitionDurationMs',
]

/** Full Settings page for library management and one-snapshot live try-on. */
export function SkinStudio(props: SkinStudioProps): ReactNode {
  const state = props.useStudio(value => value)
  const importRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLInputElement>(null)
  const [part, setPart] = useState<string>(state.parts[0]?.id ?? 'primitive.button')
  const partInfo = state.parts.find(value => value.id === part)
  const [variant, setVariant] = useState('')
  const [partState, setPartState] = useState('')
  const [field, setField] = useState<keyof ThemePartStyle>('background')
  const [lightValue, setLightValue] = useState('#315efb')
  const [darkValue, setDarkValue] = useState('#7c9cff')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const tokenNames = useMemo(() => state.tokens.map(token => token.name).sort(), [state.tokens])
  const [tokenName, setTokenName] = useState(tokenNames[0] ?? '--dsw-alias-bg-base')
  const token = state.draft.tokens[tokenName] ?? { light: '#ffffff', dark: '#111827' }
  const backdrop = state.draft.backdrop ?? {
    light: { fallbackColor: '#f5f7fb', focusX: 0.5, focusY: 0.5, dim: 0.12, blurPx: 0 },
    dark: { fallbackColor: '#0b1020', focusX: 0.5, focusY: 0.5, dim: 0.28, blurPx: 0 },
  }

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
      <header className={css.hero}>
        <div>
          <span className={css.eyebrow}>DSH COMPONENT SKINS</span>
          <h2 className={css.title}>同步组件换肤工作室</h2>
          <p className={css.subtitle}>Token、背景和核心组件外观通过同一个快照切换；皮肤不会改变组件逻辑或可访问性语义。</p>
        </div>
        <span className={css.authority} data-local={state.localManagement || undefined}>
          {state.localManagement ? 'Host 本机 · 可管理' : '远程客户端 · 只读呈现'}
        </span>
      </header>

      {state.error !== undefined && <div className={css.error} role="alert">{state.error}</div>}
      <div className={css.toolbar}>
        <Button variant="primary" disabled={manageDisabled} onClick={() => { props.beginDraft() }}>新建皮肤</Button>
        <Button variant="outline" disabled={manageDisabled} onClick={() => { importRef.current?.click() }}>导入 .dshskin</Button>
        <Button variant="ghost" disabled={manageDisabled} onClick={props.restoreDefault}>恢复 Harness 默认</Button>
        <input
          ref={importRef}
          className={css.hiddenInput}
          type="file"
          accept=".dshskin,application/zip"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file !== undefined) props.importSkin(file)
            event.currentTarget.value = ''
          }}
        />
      </div>

      <section className={css.library} aria-labelledby="skin-library-heading">
        <div className={css.sectionHeading}>
          <h3 id="skin-library-heading">已安装皮肤</h3>
          <span>激活 revision {state.host?.activationRevision ?? '—'}</span>
        </div>
        {(state.host?.skins.length ?? 0) === 0
          ? <div className={css.empty}>还没有导入皮肤。你可以从下方草稿开始创建。</div>
          : (
            <div className={css.skinGrid}>
              {state.host?.skins.map((skin) => {
                const active = skin.fingerprint === state.host?.activeFingerprint
                return (
                  <article key={skin.fingerprint} className={css.skinCard} data-active={active || undefined}>
                    <div className={css.skinCardHeader}>
                      <div><strong>{skin.name}</strong><span>v{skin.version}</span></div>
                      {active && <span className={css.activeBadge}>当前</span>}
                    </div>
                    <code>{skin.fingerprint.slice(0, 12)}</code>
                    <div className={css.cardActions}>
                      <Button variant="ghost" size="sm" disabled={!state.localManagement || state.busy} onClick={() => { props.beginDraft(skin.fingerprint) }}>编辑与试穿</Button>
                      {!active && <Button variant="primary" size="sm" disabled={manageDisabled} onClick={() => { props.activate(skin.fingerprint) }}>激活</Button>}
                      {!active && skin.fingerprint !== state.host?.previousConfirmed && (
                        <Button variant="ghost" size="sm" disabled={manageDisabled} onClick={() => { props.deleteSkin(skin.fingerprint) }}>删除</Button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
      </section>

      <div className={css.editorGrid} aria-disabled={!state.localManagement || undefined}>
        <section className={css.editorPanel}>
          <h3>草稿与模式</h3>
          <label className={css.fieldLabel}>皮肤名称
            <Input value={state.draftName} disabled={!state.localManagement} onChange={event => { props.updateDraftName(event.currentTarget.value) }} />
          </label>
          <div className={css.modeActions}>
            <Button variant="outline" size="sm" onClick={() => { props.setColorScheme('light') }}>切到 Light</Button>
            <Button variant="outline" size="sm" onClick={() => { props.setColorScheme('dark') }}>切到 Dark</Button>
            {state.previewing && <Button variant="ghost" size="sm" onClick={props.cancelPreview}>取消试穿</Button>}
          </div>
          <div className={css.saveActions}>
            <Button variant="primary" disabled={manageDisabled} onClick={props.saveDraft}>保存到 Host</Button>
            <Button variant="outline" disabled={manageDisabled} onClick={props.exportDraft}>导出 .dshskin</Button>
          </div>
        </section>

        <section className={css.editorPanel}>
          <h3>语义 Token</h3>
          <label className={css.fieldLabel}>Token
            <select value={tokenName} disabled={!state.localManagement} onChange={event => { setTokenName(event.currentTarget.value) }}>
              {tokenNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <ModeFields
            disabled={!state.localManagement}
            light={token.light}
            dark={token.dark}
            onLight={value => { props.updateToken(tokenName, 'light', value) }}
            onDark={value => { props.updateToken(tokenName, 'dark', value) }}
          />
        </section>

        <section className={css.editorPanel}>
          <h3>背景焦点与遮罩</h3>
          <label className={css.fieldLabel}>背景图片
            <input
              ref={backdropRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!state.localManagement}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file !== undefined) props.updateBackdropImage(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <BackdropFields mode="light" values={backdrop.light} disabled={!state.localManagement} update={(field, value) => { props.updateBackdrop('light', field, value) }} />
          <BackdropFields mode="dark" values={backdrop.dark} disabled={!state.localManagement} update={(field, value) => { props.updateBackdrop('dark', field, value) }} />
        </section>

        <section className={css.editorPanel}>
          <h3>组件 Part 外观</h3>
          <div className={css.threeColumns}>
            <label className={css.fieldLabel}>Part
              <select value={part} disabled={!state.localManagement} onChange={event => { setPart(event.currentTarget.value) }}>
                {state.parts.map(value => <option key={value.id} value={value.id}>{value.id}</option>)}
              </select>
            </label>
            <label className={css.fieldLabel}>Variant
              <select value={variant} disabled={!state.localManagement} onChange={event => { setVariant(event.currentTarget.value) }}>
                <option value="">默认</option>
                {partInfo?.variants.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className={css.fieldLabel}>State
              <select value={partState} disabled={!state.localManagement} onChange={event => { setPartState(event.currentTarget.value) }}>
                <option value="">默认</option>
                {partInfo?.states.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <label className={css.fieldLabel}>属性
            <select value={field} disabled={!state.localManagement} onChange={event => { setField(event.currentTarget.value as keyof ThemePartStyle) }}>
              {EDITABLE_PART_FIELDS.filter(value => partInfo?.properties.includes(value) === true).map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <ModeFields disabled={!state.localManagement} light={lightValue} dark={darkValue} onLight={setLightValue} onDark={setDarkValue} />
          <Button
            variant="primary"
            disabled={manageDisabled}
            onClick={() => { props.upsertPartRule(part, variant, partState, field, lightValue, darkValue) }}
          >应用完整规则</Button>
        </section>
      </div>

      <section className={css.previewSection}>
        <div className={css.sectionHeading}><h3>Light / Dark 并排检查</h3><span>全页试穿会同步覆盖当前 Shell 与会话组件</span></div>
        <div className={css.modePreviewGrid}>
          <ModePreview title="Light" mode="light" layer={state.draft} />
          <ModePreview title="Dark" mode="dark" layer={state.draft} />
        </div>
        <div className={css.primitives}>
          <Button variant="primary">Primary Button</Button>
          <Button variant="ghost">Ghost Button</Button>
          <Button variant="outline" disabled>Disabled</Button>
          <Input placeholder="Input control" />
          <Menu
            open={menuOpen}
            anchor={<Button variant="toolbar" onClick={() => { setMenuOpen(value => !value) }}>Menu 状态</Button>}
            items={[{ id: 'selected', label: 'Selected item' }, { id: 'disabled', label: 'Disabled item', disabled: true }]}
            selectedId="selected"
            onSelect={() => { setMenuOpen(false) }}
            onClose={() => { setMenuOpen(false) }}
          />
          <Button variant="outline" onClick={() => { setDialogOpen(true) }}>Dialog 预览</Button>
        </div>
      </section>

      <Modal
        open={dialogOpen}
        title="组件皮肤 Dialog"
        onClose={() => { setDialogOpen(false) }}
        footer={<Button variant="primary" onClick={() => { setDialogOpen(false) }}>完成</Button>}
      >
        这里使用 Harness 真实 Dialog Surface 与 Button Part。
      </Modal>
    </section>
  )
}

function ModeFields({ disabled, light, dark, onLight, onDark }: {
  disabled: boolean
  light: string
  dark: string
  onLight: (value: string) => void
  onDark: (value: string) => void
}): ReactNode {
  return (
    <div className={css.modeFields}>
      <label className={css.fieldLabel}>Light<Input value={light} disabled={disabled} onChange={event => { onLight(event.currentTarget.value) }} /></label>
      <label className={css.fieldLabel}>Dark<Input value={dark} disabled={disabled} onChange={event => { onDark(event.currentTarget.value) }} /></label>
    </div>
  )
}

function BackdropFields({ mode, values, disabled, update }: {
  mode: 'light' | 'dark'
  values: { fallbackColor: ThemeColorValue; focusX: number; focusY: number; dim: number; blurPx: number }
  disabled: boolean
  update: (field: 'fallbackColor' | 'focusX' | 'focusY' | 'dim' | 'blurPx', value: string) => void
}): ReactNode {
  return (
    <fieldset className={css.backdropFields} disabled={disabled}>
      <legend>{mode === 'light' ? 'Light' : 'Dark'}</legend>
      <label>回退色<Input value={displayColor(values.fallbackColor)} onChange={event => { update('fallbackColor', event.currentTarget.value) }} /></label>
      <label>焦点 X<input type="range" min="0" max="1" step="0.01" value={values.focusX} onChange={event => { update('focusX', event.currentTarget.value) }} /></label>
      <label>焦点 Y<input type="range" min="0" max="1" step="0.01" value={values.focusY} onChange={event => { update('focusY', event.currentTarget.value) }} /></label>
      <label>暗化<input type="range" min="0" max="1" step="0.01" value={values.dim} onChange={event => { update('dim', event.currentTarget.value) }} /></label>
      <label>模糊<input type="range" min="0" max="30" step="1" value={values.blurPx} onChange={event => { update('blurPx', event.currentTarget.value) }} /></label>
    </fieldset>
  )
}

function ModePreview({ title, mode, layer }: { title: string; mode: 'light' | 'dark'; layer: ThemeLayerDefinition }): ReactNode {
  const variables: CSSProperties & Record<string, string> = {}
  for (const [name, value] of Object.entries(layer.tokens)) {
    if (value !== undefined) variables[name] = value[mode]
  }
  return (
    <div className={css.modePreview} style={variables} data-mode={mode} data-dsh-theme-preview-mode={mode}>
      <span>{title}</span>
      <div className={css.sampleSidebar} data-dsh-theme-part="shell.sidebar">Sidebar</div>
      <div className={css.sampleMain} data-dsh-theme-part="shell.main">
        <div data-dsh-theme-part="conversation.message" data-dsh-theme-variant="assistant">Assistant message</div>
        <div data-dsh-theme-part="conversation.message" data-dsh-theme-variant="user">User message</div>
      </div>
    </div>
  )
}

function displayColor(value: ThemeColorValue): string {
  return typeof value === 'string' ? value : `$token:${value.token}`
}

function displayPartValue(value: ThemePartStyle[keyof ThemePartStyle] | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'object') {
    if ('token' in value) return `$token:${value.token}`
    return JSON.stringify(value)
  }
  return String(value)
}
