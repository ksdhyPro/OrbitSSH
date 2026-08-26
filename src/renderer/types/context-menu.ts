export interface ContextMenuItem {
  key: string
  label: string
  icon?: string
  /** 子菜单项；存在时悬浮展开右侧子菜单。 */
  children?: ContextMenuItem[]
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
