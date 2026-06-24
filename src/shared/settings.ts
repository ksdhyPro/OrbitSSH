export interface TerminalSettings {
  fontSize: number
  lineHeight: number
  selectionBackground: string
}

export interface AppSettings {
  terminal: TerminalSettings
}

export const defaultAppSettings: AppSettings = {
  terminal: {
    fontSize: 13,
    lineHeight: 1.2,
    selectionBackground: '#244763'
  }
}
