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

export interface UpdateSettings {
  /** 更新服务器地址，空字符串表示使用构建时内置的默认地址 */
  updateFeedUrl: string
}

export interface AppSettings {
  appearance: AppearanceSettings
  terminal: TerminalSettings
  sftp: SftpSettings
  update: UpdateSettings
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatusInfo {
  status: UpdateStatus
  currentVersion: string
  newVersion?: string
  releaseDate?: string
  releaseNotes?: string
  downloadProgress?: number
  error?: string
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
  },
  update: {
    updateFeedUrl: ''
  }
}
