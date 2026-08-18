export interface ContextMenuItem {
  key: string
  label: string
  icon?: string
  group?: string
  desc?: string
  disabled?: boolean
  danger?: boolean
  warning?: boolean
}

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
}
