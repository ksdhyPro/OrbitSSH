export interface TerminalSettings {
  fontSize: number
  lineHeight: number
  selectionBackground: string
}

export type AppThemeMode = 'dark' | 'light'

export interface AppearanceSettings {
  themeMode: AppThemeMode
}

export type SftpFileTreeViewMode = 'current-directory' | 'tree'

export interface SftpSettings {
  fileTreeViewMode: SftpFileTreeViewMode
}

export interface AppSettings {
  appearance: AppearanceSettings
  terminal: TerminalSettings
  sftp: SftpSettings
}

export const defaultAppSettings: AppSettings = {
  appearance: {
    themeMode: 'dark'
  },
  terminal: {
    fontSize: 13,
    lineHeight: 1.2,
    selectionBackground: '#244763'
  },
  sftp: {
    fileTreeViewMode: 'current-directory'
  }
}
