import { safeStorage } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_AI_CONTEXT_WINDOW,
  defaultAppSettings,
  type AppSettings,
  type AiModelConfig,
  type AiSettings,
  type AiProvider,
  type AiApiSpec,
  type AiInputModality,
  type AiReasoningMode,
  type AppThemeMode
} from '../../shared/settings.js'
import { MAX_AI_ATTACHMENT_SIZE_MB } from '../../shared/ai.js'
import {
  normalizeAiReasoningEffort,
  normalizeAiReasoningParameter,
  normalizeAiReasoningValues
} from '../../shared/ai-reasoning.js'

interface SettingsStoreSchema {
  settings: AppSettings
  aiApiKeys: Record<string, string>
  connectionDefaultsMigrationVersion: number
}

const currentConnectionDefaultsMigrationVersion = 1
const legacyConnectionDefaults = {
  keepaliveIntervalSeconds: 10,
  idleDisconnectMinutes: 5
}

const store = new Store<SettingsStoreSchema>({
  name: 'settings',
  defaults: {
    settings: defaultAppSettings,
    aiApiKeys: {},
    connectionDefaultsMigrationVersion: 0
  }
})

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizeThemeMode(value: unknown): AppThemeMode {
  return value === 'light' ? 'light' : defaultAppSettings.appearance.themeMode
}

function normalizeKeepaliveIntervalSeconds(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue)
    ? clampNumber(numericValue, 0, 300)
    : defaultAppSettings.connection.keepaliveIntervalSeconds
}

function normalizeIdleDisconnectMinutes(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue)
    ? clampNumber(numericValue, 0, 1440)
    : defaultAppSettings.connection.idleDisconnectMinutes
}

function normalizeAiProvider(value: unknown): AiProvider {
  const provider = normalizeString(value)
  return provider || 'other'
}

function normalizeAiReasoningMode(value: unknown): AiReasoningMode {
  return value === 'toggle' || value === 'effort' ? value : 'none'
}

function normalizeAiInputModalities(value: unknown): AiInputModality[] {
  if (!Array.isArray(value)) return ['text']
  const allowed: AiInputModality[] = ['text', 'image', 'audio', 'video', 'pdf', 'file']
  const modalities = value.filter((item): item is AiInputModality =>
    typeof item === 'string' && allowed.includes(item as AiInputModality)
  )
  return modalities.length > 0 ? Array.from(new Set(modalities)) : ['text']
}

function normalizeAiSpec(value: unknown): AiApiSpec {
  return value === 'openai' || value === 'anthropic' || value === 'responses'
    ? value
    : 'openai'
}

function normalizeAiMode(value: unknown): AiSettings['defaultMode'] {
  if (value === 'ask' || value === 'full') {
    return value
  }

  if (value === 'auto' || value === 'readonly') {
    return 'full'
  }

  if (value === 'suggest' || value === 'approval') {
    return 'ask'
  }

  return defaultAppSettings.ai.defaultMode
}

function normalizeMaxAgentCommandCount(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue)
    ? clampNumber(Math.floor(numericValue), 1, 100)
    : defaultAppSettings.ai.maxAgentCommandCount
}

function normalizeCommandTimeoutMinutes(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue)
    ? clampNumber(Math.floor(numericValue), 0, 1440)
    : defaultAppSettings.ai.commandTimeoutMinutes
}

function normalizeMaxAttachmentSizeMb(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue)
    ? clampNumber(Math.floor(numericValue), 1, MAX_AI_ATTACHMENT_SIZE_MB)
    : defaultAppSettings.ai.maxAttachmentSizeMb
}

function normalizeCommandApprovalTimeoutMinutes(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue)
    ? clampNumber(Math.floor(numericValue), 0, 1440)
    : defaultAppSettings.ai.commandApprovalTimeoutMinutes
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统暂不支持安全 AI Key 存储')
  }

  return safeStorage.encryptString(value).toString('base64')
}

function decryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统暂不支持安全 AI Key 读取')
  }

  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

// 生成本地 AI 配置 ID，避免保存多个配置时出现空 ID 或重复 ID。
function createAiConfigId(): string {
  return `ai-${randomUUID()}`
}

type LegacyAiModelConfig = Partial<AiModelConfig> & {
  contextLength?: unknown
  contextSize?: unknown
  contextTokens?: unknown
  maxTokens?: unknown
  maxOutput?: unknown
  outputTokens?: unknown
  maxCompletionTokens?: unknown
  outputLimit?: unknown
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numericValue = Number(value)
    if (Number.isFinite(numericValue)) return numericValue
  }
  return null
}

// 归一化单个 AI 配置，旧配置默认迁移为 OpenAI Chat Completions。
function normalizeAiModelConfig(
  value: LegacyAiModelConfig | undefined,
  index: number,
  usedIds: Set<string>
): AiModelConfig {
  const rawId = normalizeString(value?.id)
  const id = rawId && !usedIds.has(rawId) ? rawId : createAiConfigId()
  usedIds.add(id)

  const provider = normalizeAiProvider(value?.provider)
  const providerName = normalizeString(value?.providerName) || provider
  const model = normalizeString(value?.model)
  const name = normalizeString(value?.name) || model || `模型 ${index + 1}`
  const baseUrl = normalizeString(value?.baseUrl)
  const contextWindowValue = firstFiniteNumber(
    value?.contextWindow,
    value?.contextLength,
    value?.contextSize,
    value?.contextTokens
  )
  const maxOutputTokensValue = firstFiniteNumber(
    value?.maxOutputTokens,
    value?.maxTokens,
    value?.maxOutput,
    value?.outputTokens,
    value?.maxCompletionTokens,
    value?.outputLimit
  )
  const inputModalities = normalizeAiInputModalities(value?.inputModalities)
  const legacyReasoningMode = normalizeAiReasoningMode(value?.reasoningMode)
  const legacyReasoningParameter =
    legacyReasoningMode === 'effort'
      ? 'reasoning_effort'
      : legacyReasoningMode === 'toggle'
        ? 'thinking.type'
        : ''
  const reasoningParameter = normalizeAiReasoningParameter(
    value?.reasoningParameter || legacyReasoningParameter
  )
  const reasoningEffortOptions = normalizeAiReasoningValues(value?.reasoningEffortOptions)
  const reasoningEffort = normalizeAiReasoningEffort(
    value?.reasoningEffort,
    legacyReasoningMode === 'toggle' ? 'enabled' : 'medium'
  )
  const contextWindow = contextWindowValue !== null
    ? clampNumber(contextWindowValue, 4_096, 4_000_000)
    : DEFAULT_CUSTOM_AI_CONTEXT_WINDOW
  const maxOutputTokens = maxOutputTokensValue !== null
    ? clampNumber(maxOutputTokensValue, 256, Math.min(262_144, contextWindow - 1))
    : Math.min(DEFAULT_AI_MAX_OUTPUT_TOKENS, contextWindow - 1)
  const hasPersistedModelLimits = contextWindowValue !== null && maxOutputTokensValue !== null

  return {
    id,
    name,
    spec: normalizeAiSpec(value?.spec),
    provider,
    providerName,
    baseUrl,
    apiKey: normalizeString(value?.apiKey),
    model,
    contextWindow,
    maxOutputTokens,
    reasoningEnabled: Boolean(reasoningParameter) && value?.reasoningEnabled !== false,
    reasoningParameter,
    reasoningEffort,
    reasoningEffortOptions,
    inputModalities,
    supportsAttachments:
      value?.supportsAttachments === true || inputModalities.some(item => item !== 'text'),
    catalogMetadataSynced:
      value?.catalogMetadataSynced === true ||
      (value?.catalogMetadataSynced !== false && hasPersistedModelLimits)
  }
}

function hasLegacyAiConfigShape(settings: Partial<AppSettings> | undefined): boolean {
  const configs = (settings?.ai as { configs?: unknown } | undefined)?.configs
  if (!Array.isArray(configs)) return false

  const requiredFields = [
    'providerName',
    'contextWindow',
    'maxOutputTokens',
    'reasoningEnabled',
    'reasoningParameter',
    'reasoningEffort',
    'reasoningEffortOptions',
    'inputModalities',
    'supportsAttachments',
    'catalogMetadataSynced'
  ]

  return configs.some((config) => {
    if (!config || typeof config !== 'object') return true
    return requiredFields.some((field) => !Object.hasOwn(config, field))
  })
}

function normalizeAiSettings(value: Partial<AiSettings> | undefined): AiSettings {
  const mode = (value as { defaultMode?: unknown } | undefined)?.defaultMode
  const usedIds = new Set<string>()
  const rawConfigs = Array.isArray(value?.configs) ? value.configs : []
  const configs = rawConfigs.map((item, index) => normalizeAiModelConfig(item, index, usedIds))
  const requestedActiveConfigId = normalizeString(value?.activeConfigId)
  const activeConfigId = configs.some(config => config.id === requestedActiveConfigId)
    ? requestedActiveConfigId
    : configs[0]?.id ?? ''
  const requestedMultimodalConfigId = normalizeString(value?.multimodalConfigId)
  const multimodalConfigId = configs.some(
    config => config.id === requestedMultimodalConfigId && config.supportsAttachments
  )
    ? requestedMultimodalConfigId
    : ''

  return {
    enabled: value?.enabled !== false,
    shareTerminalContext: value?.shareTerminalContext !== false,
    maxAttachmentSizeMb: normalizeMaxAttachmentSizeMb(value?.maxAttachmentSizeMb),
    maxAgentCommandCount: normalizeMaxAgentCommandCount(value?.maxAgentCommandCount),
    commandTimeoutMinutes: normalizeCommandTimeoutMinutes(value?.commandTimeoutMinutes),
    commandApprovalTimeoutMinutes: normalizeCommandApprovalTimeoutMinutes(
      value?.commandApprovalTimeoutMinutes
    ),
    activeConfigId,
    multimodalConfigId,
    configs,
    defaultMode: normalizeAiMode(mode)
  }
}

function normalizeSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  const appearanceSettings = settings?.appearance ?? defaultAppSettings.appearance
  const connectionSettings = settings?.connection ?? defaultAppSettings.connection
  const terminalSettings = settings?.terminal ?? defaultAppSettings.terminal
  const updateSettings = settings?.update ?? defaultAppSettings.update

  return {
    appearance: {
      themeMode: normalizeThemeMode(appearanceSettings.themeMode)
    },
    connection: {
      keepaliveIntervalSeconds: normalizeKeepaliveIntervalSeconds(connectionSettings.keepaliveIntervalSeconds),
      idleDisconnectMinutes: normalizeIdleDisconnectMinutes(connectionSettings.idleDisconnectMinutes)
    },
    terminal: {
      fontSize: clampNumber(Number(terminalSettings.fontSize), 10, 24),
      lineHeight: clampNumber(Number(terminalSettings.lineHeight), 1, 2),
      selectionBackground:
        typeof terminalSettings.selectionBackground === 'string'
          ? terminalSettings.selectionBackground
          : defaultAppSettings.terminal.selectionBackground,
      openLocalTerminalOnStartup:
        terminalSettings.openLocalTerminalOnStartup !== false
    },
    update: {
      updateFeedUrl:
        typeof updateSettings.updateFeedUrl === 'string'
          ? updateSettings.updateFeedUrl
          : defaultAppSettings.update.updateFeedUrl
    },
    ai: normalizeAiSettings(settings?.ai)
  }
}

function getAiApiKeys(): Record<string, string> {
  return store.get('aiApiKeys', {})
}

function cloneSettingsWithoutAiApiKeys(settings: AppSettings): AppSettings {
  return {
    ...settings,
    ai: {
      ...settings.ai,
      configs: settings.ai.configs.map(config => ({
        ...config,
        apiKey: ''
      }))
    }
  }
}

// AI Key 单独密文保存，settings 里只保留模型配置，避免明文落盘。
function persistSettingsWithEncryptedAiKeys(settings: AppSettings): void {
  const previousApiKeys = getAiApiKeys()
  const nextApiKeys: Record<string, string> = {}

  for (const config of settings.ai.configs) {
    if (config.apiKey) {
      nextApiKeys[config.id] = encryptSecret(config.apiKey)
      continue
    }

    if (previousApiKeys[config.id]) {
      nextApiKeys[config.id] = previousApiKeys[config.id]
    }
  }

  store.set('aiApiKeys', nextApiKeys)
  store.set('settings', cloneSettingsWithoutAiApiKeys(settings))
}

function hydrateAiApiKeys(settings: AppSettings): AppSettings {
  const apiKeys = getAiApiKeys()

  return {
    ...settings,
    ai: {
      ...settings.ai,
      configs: settings.ai.configs.map(config => {
        const encryptedApiKey = apiKeys[config.id]

        return {
          ...config,
          apiKey:
            encryptedApiKey
              ? decryptSecret(encryptedApiKey)
              : config.apiKey
        }
      })
    }
  }
}

function hasPlainTextAiApiKey(settings: AppSettings): boolean {
  return settings.ai.configs.some(config => Boolean(config.apiKey))
}

function migrateLegacyConnectionDefaults(): void {
  const migrationVersion = store.get('connectionDefaultsMigrationVersion', 0)

  if (migrationVersion >= currentConnectionDefaultsMigrationVersion) {
    return
  }

  const persistedSettings = store.get('settings', defaultAppSettings)
  const connection = persistedSettings?.connection
  const usesLegacyDefaults =
    Number(connection?.keepaliveIntervalSeconds) === legacyConnectionDefaults.keepaliveIntervalSeconds &&
    Number(connection?.idleDisconnectMinutes) === legacyConnectionDefaults.idleDisconnectMinutes

  if (usesLegacyDefaults) {
    store.set('settings', {
      ...persistedSettings,
      connection: {
        ...connection,
        ...defaultAppSettings.connection
      }
    })
  }

  store.set(
    'connectionDefaultsMigrationVersion',
    currentConnectionDefaultsMigrationVersion
  )
}

export function getSettings(): AppSettings {
  migrateLegacyConnectionDefaults()
  const rawSettings = store.get('settings', defaultAppSettings)
  const normalizedSettings = normalizeSettings(rawSettings)
  const hydratedSettings = hydrateAiApiKeys(normalizedSettings)

  // 旧版模型字段只在内存中补默认值会导致每次升级后再次丢失，读取时一次性落盘迁移。
  if (hasPlainTextAiApiKey(normalizedSettings) || hasLegacyAiConfigShape(rawSettings)) {
    persistSettingsWithEncryptedAiKeys(hydratedSettings)
  }

  return hydratedSettings
}

export function saveSettings(settings: AppSettings): AppSettings {
  const normalizedSettings = normalizeSettings(settings)
  persistSettingsWithEncryptedAiKeys(normalizedSettings)

  return hydrateAiApiKeys(normalizedSettings)
}
