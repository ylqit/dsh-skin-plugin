import type { ReactNode } from 'react'
import css from './experience.module.css'

interface ExperienceProps {
  themeId: string
  mode: 'light' | 'dark'
  assets: Readonly<Record<string, string>>
}

function ThemeTop({ themeId }: ExperienceProps): ReactNode {
  return <div className={css.top}>Theme experience · {themeId}</div>
}

function FloatingMark({ mode, assets }: ExperienceProps): ReactNode {
  const image = assets[mode === 'light' ? 'backdrop-light.webp' : 'backdrop-dark.webp']
  return <div className={css.mark}>{image === undefined ? 'THEME' : <img src={image} alt="" />}</div>
}

export default {
  apiVersion: 1,
  components: {
    'skin.shell.top': ThemeTop,
    'skin.shell.floating': FloatingMark,
  },
}
