import Store from 'electron-store'

import {
  defaultAppSettings,
  type AppSettings,
  type AppThemeMode,
  type SftpFileTreeViewMode
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

function normalizeSftpFileTreeViewMode(value: unknown): SftpFileTreeViewMode {
  return value === 'tree' ? 'tree' : defaultAppSettings.sftp.fileTreeViewMode
}

function normalizeThemeMode(value: unknown): AppThemeMode {
  return value === 'light' ? 'light' : defaultAppSettings.appearance.themeMode
}

function normalizeSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  const appearanceSettings = settings?.appearance ?? defaultAppSettings.appearance
  const terminalSettings = settings?.terminal ?? defaultAppSettings.terminal
  const sftpSettings = settings?.sftp ?? defaultAppSettings.sftp

  return {
    appearance: {
      themeMode: normalizeThemeMode(appearanceSettings.themeMode)
    },
    terminal: {
      fontSize: clampNumber(Number(terminalSettings.fontSize), 10, 24),
      lineHeight: clampNumber(Number(terminalSettings.lineHeight), 1, 2),
      selectionBackground:
        typeof terminalSettings.selectionBackground === 'string'
          ? terminalSettings.selectionBackground
          : defaultAppSettings.terminal.selectionBackground
    },
    sftp: {
      fileTreeViewMode: normalizeSftpFileTreeViewMode(sftpSettings.fileTreeViewMode)
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
