import type { Component } from "vue";

export interface ContextMenuItem {
  key: string
  label: string
  icon?: string
  iconComponent?: Component
  desc?: string
  disabled?: boolean
  danger?: boolean
}

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
}
