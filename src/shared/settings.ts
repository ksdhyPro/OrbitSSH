import type { AiMode } from './ai.js'

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
  /** 上传、下载和服务器间传输共享的全局并发任务数。 */
  sftpMaxConcurrentTransfers: number
}

export const SFTP_TRANSFER_CONCURRENCY_MIN = 1
export const SFTP_TRANSFER_CONCURRENCY_MAX = 5

export type AppThemeMode = 'dark' | 'light'

export interface AppearanceSettings {
  themeMode: AppThemeMode
}

/** 左侧折叠面板的展开状态与上次调整后的高度。 */
export interface SidebarPanelSettings {
  collapsed: boolean
  height: number
}

export interface SidebarSettings {
  servers: SidebarPanelSettings
  automation: SidebarPanelSettings
  remoteFiles: SidebarPanelSettings
  /** 左侧面板从上到下的显示顺序。 */
  panelOrder: Array<'servers' | 'automation' | 'remoteFiles'>
}

export interface UpdateSettings {
  /** 更新服务器地址，空字符串表示使用构建时内置的默认地址 */
  updateFeedUrl: string
}

export type AiProvider = 'deepseek' | 'glm' | 'other'

/** 用户预提示词最大长度，避免设置项无限占用模型上下文。 */
export const AI_PRESET_PROMPT_MAX_CHARS = 8_000

export interface AiModelConfig {
  id: string
  name: string
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
  /** 模型上下文窗口总 Token 限制，单位为 K（千 Token）。 */
  contextTokenLimitK: number
}

export interface AiSettings {
  enabled: boolean
  /** 是否允许把脱敏后的最近终端输出发送给在线模型。 */
  shareTerminalContext: boolean
  /** 每次 AI 对话请求都会附带的用户自定义预提示词。 */
  presetPrompt: string
  activeConfigId: string
  configs: AiModelConfig[]
  defaultMode: AiMode
}

export interface AppSettings {
  appearance: AppearanceSettings
  sidebar: SidebarSettings
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
  sidebar: {
    servers: {
      collapsed: false,
      height: 280
    },
    automation: {
      collapsed: false,
      height: 180
    },
    remoteFiles: {
      collapsed: false,
      height: 360
    },
    panelOrder: ['servers', 'automation', 'remoteFiles']
  },
  connection: {
    keepaliveIntervalSeconds: 10,
    idleDisconnectMinutes: 5,
    sftpMaxConcurrentTransfers: 3
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
    shareTerminalContext: false,
    presetPrompt: '',
    activeConfigId: '',
    configs: [],
    defaultMode: 'auto'
  }
}
