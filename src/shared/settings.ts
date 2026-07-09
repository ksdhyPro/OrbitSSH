export interface TerminalSettings {
  fontSize: number
  lineHeight: number
  selectionBackground: string
}

export interface ConnectionSettings {
  /** SSH/SFTP keepalive interval in seconds. 0 disables keepalive. */
  keepaliveIntervalSeconds: number
  /** Disconnect idle terminal and main SFTP sessions after this many minutes. 0 disables idle disconnect. */
  idleDisconnectMinutes: number
}

export type AppThemeMode = 'dark' | 'light'

export interface AppearanceSettings {
  themeMode: AppThemeMode
}

export interface UpdateSettings {
  /** 更新服务器地址，空字符串表示使用构建时内置的默认地址 */
  updateFeedUrl: string
}

export type AiProvider = 'deepseek' | 'glm' | 'other'
export type AiApiSpec = 'openai'

export interface AiModelConfig {
  id: string
  name: string
  spec: AiApiSpec
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
}

export interface AiSettings {
  enabled: boolean
  activeConfigId: string
  configs: AiModelConfig[]
  defaultMode: 'ask' | 'full'
}

export interface AppSettings {
  appearance: AppearanceSettings
  connection: ConnectionSettings
  terminal: TerminalSettings
  update: UpdateSettings
  ai: AiSettings
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
  connection: {
    keepaliveIntervalSeconds: 10,
    idleDisconnectMinutes: 5
  },
  terminal: {
    fontSize: 13,
    lineHeight: 1.2,
    selectionBackground: '#244763'
  },
  update: {
    updateFeedUrl: ''
  },
  ai: {
    enabled: false,
    activeConfigId: '',
    configs: [],
    defaultMode: 'full'
  }
}
