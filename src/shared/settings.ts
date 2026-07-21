import {
  DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB,
} from './ai.js'

export interface TerminalSettings {
  fontSize: number
  lineHeight: number
  selectionBackground: string
  /** Open a local shell automatically after application startup. */
  openLocalTerminalOnStartup: boolean
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

export type AiProvider = string
export type AiApiSpec = 'openai' | 'anthropic' | 'responses'

export type AiReasoningMode = 'none' | 'toggle' | 'effort'
export type AiInputModality = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'file'

export interface AiModelConfig {
  id: string
  name: string
  spec: AiApiSpec
  provider: AiProvider
  providerName: string
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  /** 旧版配置迁移字段，不再由界面暴露。 */
  reasoningMode?: AiReasoningMode
  reasoningEnabled: boolean
  reasoningParameter: string
  reasoningEffort: string
  reasoningEffortOptions: string[]
  inputModalities: AiInputModality[]
  supportsAttachments: boolean
  /** Whether the persisted values were last populated from the models.dev catalog. */
  catalogMetadataSynced?: boolean
}

export interface AiSettings {
  enabled: boolean
  /** 是否允许把脱敏后的最近终端输出发送给在线模型，默认开启。 */
  shareTerminalContext: boolean
  /** Maximum size of one AI attachment selected by the user. */
  maxAttachmentSizeMb: number
  /** Maximum number of commands an agent may execute for one user request. */
  maxAgentCommandCount: number
  /** Command approval lifetime in minutes. 0 keeps approvals until explicitly cleared. */
  commandApprovalTimeoutMinutes: number
  activeConfigId: string
  multimodalConfigId: string
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

/** models.dev 无数据时，仅用于自定义/未知模型的保守回退值。 */
export const DEFAULT_CUSTOM_AI_CONTEXT_WINDOW = 200_000
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 8_192

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
    themeMode: 'light'
  },
  connection: {
    keepaliveIntervalSeconds: 30,
    idleDisconnectMinutes: 0
  },
  terminal: {
    fontSize: 13,
    lineHeight: 1.2,
    selectionBackground: '#244763',
    openLocalTerminalOnStartup: true
  },
  update: {
    updateFeedUrl: ''
  },
  ai: {
    enabled: false,
    shareTerminalContext: true,
    maxAttachmentSizeMb: DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB,
    maxAgentCommandCount: 20,
    commandApprovalTimeoutMinutes: 0,
    activeConfigId: '',
    multimodalConfigId: '',
    configs: [],
    defaultMode: 'full'
  }
}
