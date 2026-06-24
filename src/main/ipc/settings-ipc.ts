import { ipcMain } from 'electron'

import { getSettings, saveSettings } from '../storage/settings-store.js'
import type { AppSettings } from '../../shared/settings.js'

// 注册应用设置 IPC，Renderer 只通过安全 API 读写本地缓存。
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => saveSettings(settings))
}
