import type { ReactNode } from 'react'
import css from './experience.module.css'

function WaterPressure(): ReactNode {
  return <div className={css.pressure}><i className={css.ball} /><span>杰尼龟 · 水属性</span><div className={css.gauge}><i /><i /><i /><i /></div><strong>水枪 · READY</strong></div>
}

function Bubbles(): ReactNode {
  return <div className={css.bubbles} aria-hidden="true"><i /><i /><i /></div>
}

export default { apiVersion: 1, components: { 'skin.shell.bottom': WaterPressure, 'skin.shell.floating': Bubbles } }
