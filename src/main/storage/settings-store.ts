import Store from 'electron-store'

import { defaultAppSettings, type AppSettings } from '../../shared/settings.js'

const store = new Store<{ settings: AppSettings }>({
  name: 'settings',
  defaults: {
    settings: defaultAppSettings
  }
})

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizeSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  const terminalSettings = settings?.terminal ?? defaultAppSettings.terminal

  return {
    terminal: {
      fontSize: clampNumber(Number(terminalSettings.fontSize), 10, 24),
      lineHeight: clampNumber(Number(terminalSettings.lineHeight), 1, 2),
      selectionBackground:
        typeof terminalSettings.selectionBackground === 'string'
          ? terminalSettings.selectionBackground
          : defaultAppSettings.terminal.selectionBackground
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
