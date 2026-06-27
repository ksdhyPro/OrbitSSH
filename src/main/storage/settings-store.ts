import Store from 'electron-store'

import {
  defaultAppSettings,
  type AppSettings,
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
    }
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
