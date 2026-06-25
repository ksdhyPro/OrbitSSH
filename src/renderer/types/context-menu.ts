export interface ContextMenuItem {
  key: string
  label: string
  icon?: string
  disabled?: boolean
  danger?: boolean
}

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
}
