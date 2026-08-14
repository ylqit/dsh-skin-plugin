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
    title?: ReactNode
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
