declare module '@deepseek-ai/dsh-client-ui-theme' {
  export const THEME_PARTS_VERSION: number
  export function validateThemeLayer(value: unknown): import('./shared/contracts.ts').ThemeLayerDefinition
  export function compileThemeLayerCss(value: unknown): string
  export function themeLayerFingerprint(value: unknown): string
  export function registerThemeBootSource(
    ctx: import('@deepseek-ai/cordis').Context,
    source: string,
    read: () => {
      activationRevision: number
      contentFingerprint: string
      layer: import('./shared/contracts.ts').ThemeLayerDefinition
    } | undefined,
  ): () => void
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
  export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    size?: 'md' | 'sm'
    icon?: ReactNode
  }): ReactNode
  export function Input(props: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }): ReactNode
  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: string
    children?: ReactNode
    footer?: ReactNode
  }): ReactNode
  export interface MenuItem { id: string; label: ReactNode; disabled?: boolean }
  export function Menu(props: {
    open: boolean
    anchor: ReactNode
    items: readonly MenuItem[]
    selectedId?: string
    onSelect: (id: string) => void
    onClose: () => void
  }): ReactNode
}
