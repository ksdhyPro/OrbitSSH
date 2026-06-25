export interface TerminalSettings {
  fontSize: number
  lineHeight: number
  selectionBackground: string
}

export type SftpFileTreeViewMode = 'current-directory' | 'tree'

export interface SftpSettings {
  fileTreeViewMode: SftpFileTreeViewMode
}

export interface AppSettings {
  terminal: TerminalSettings
  sftp: SftpSettings
}

export const defaultAppSettings: AppSettings = {
  terminal: {
    fontSize: 13,
    lineHeight: 1.2,
    selectionBackground: '#244763'
  },
  sftp: {
    fileTreeViewMode: 'current-directory'
  }
}
