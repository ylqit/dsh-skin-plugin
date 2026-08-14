import type { ReactNode } from 'react'
import css from './experience.module.css'

interface Props { themeId: string; mode: 'light' | 'dark'; assets: Readonly<Record<string, string>> }

function LeafBrand(): ReactNode {
  return <div className={css.brand}><i className={css.ball} /><span>☘</span><div><strong>妙蛙种子</strong><small>草 / 毒属性 · 搭档就绪</small></div></div>
}

function GrowthHero({ mode, assets }: Props): ReactNode {
  const src = assets[mode === 'light' ? 'backdrop-light.webp' : 'backdrop-dark.webp']
  return <div className={css.hero}>{src !== undefined && <img src={src} alt="妙蛙种子植物主题" />}<div><span>搭档招式计量槽</span><strong>藤鞭 · 86%</strong><div className={css.gauge}><i /><i /><i /><i /></div><small>日光正在积蓄</small></div></div>
}

export default { apiVersion: 1, components: { 'skin.sidebar.brand': LeafBrand, 'skin.conversation.hero': GrowthHero } }
