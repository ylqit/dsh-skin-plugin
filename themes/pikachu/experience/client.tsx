import type { ReactNode } from 'react'
import css from './experience.module.css'

interface Props { themeId: string; mode: 'light' | 'dark'; assets: Readonly<Record<string, string>> }

function EnergyRail(): ReactNode {
  return <div className={css.rail}><i className={css.ball} /><strong>皮卡丘 · 电属性</strong><div className={css.gauge}><span /><span /><span /></div><b>同步招式 READY</b></div>
}

function BoltBadge({ mode, assets }: Props): ReactNode {
  const src = assets[mode === 'light' ? 'backdrop-light.webp' : 'backdrop-dark.webp']
  return <div className={css.badge}>{src === undefined ? <span>⚡</span> : <img src={src} alt="皮卡丘电能主题" />}<em>⚡</em></div>
}

export default { apiVersion: 1, components: { 'skin.shell.top': EnergyRail, 'skin.shell.floating': BoltBadge } }
