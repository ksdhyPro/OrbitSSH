import Store from 'electron-store'
import { randomUUID } from 'node:crypto'

import {
  defaultAppSettings,
  type AppSettings,
  type AiModelConfig,
  type AiSettings,
  type AiProvider,
  type AiApiSpec,
  type AppThemeMode
} from '../../shared/settings.js'

const store = new Store<{ settings: AppSettings }>({
  name: 'settings',
  defaults: {
    settings: defaultAppSettings
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
  return value === 'deepseek' || value === 'glm' || value === 'other'
    ? value
    : 'other'
}

function normalizeAiSpec(value: unknown): AiApiSpec {
  return value === 'openai' ? value : 'openai'
}

function normalizeAiMode(value: unknown): AiSettings['defaultMode'] {
  if (value === 'ask' || value === 'auto' || value === 'full') {
    return value
  }

  if (value === 'readonly') {
    return 'auto'
  }

  if (value === 'suggest' || value === 'approval') {
    return 'ask'
  }

  return defaultAppSettings.ai.defaultMode
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// 生成本地 AI 配置 ID，避免保存多个配置时出现空 ID 或重复 ID。
function createAiConfigId(): string {
  return `ai-${randomUUID()}`
}

// 归一化单个 AI 配置，主进程只保存 OpenAI 兼容格式需要的字段。
function normalizeAiModelConfig(
  value: Partial<AiModelConfig> | undefined,
  index: number,
  usedIds: Set<string>
): AiModelConfig {
  const rawId = normalizeString(value?.id)
  const id = rawId && !usedIds.has(rawId) ? rawId : createAiConfigId()
  usedIds.add(id)

  const provider = normalizeAiProvider(value?.provider)
  const model = normalizeString(value?.model)
  const name = normalizeString(value?.name) || model || `模型 ${index + 1}`
  const baseUrl = normalizeString(value?.baseUrl)

  return {
    id,
    name,
    spec: normalizeAiSpec(value?.spec),
    provider,
    baseUrl,
    apiKey: normalizeString(value?.apiKey),
    model
  }
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

  return {
    enabled: Boolean(value?.enabled),
    activeConfigId,
    configs,
    defaultMode: normalizeAiMode(mode),
    allowReadonlyAutoRun:
      typeof value?.allowReadonlyAutoRun === 'boolean'
        ? value.allowReadonlyAutoRun
        : defaultAppSettings.ai.allowReadonlyAutoRun
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
          : defaultAppSettings.terminal.selectionBackground
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

export function getSettings(): AppSettings {
  return normalizeSettings(store.get('settings', defaultAppSettings))
}

export function saveSettings(settings: AppSettings): AppSettings {
  const normalizedSettings = normalizeSettings(settings)
  store.set('settings', normalizedSettings)

  return normalizedSettings
}
