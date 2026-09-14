import { ipcMain } from 'electron'

import { getSettings, saveSettings } from '../storage/settings-store.js'
import { setMaxConcurrentTransferTasks } from '../sftp/sftp-transfer-common.js'
import type { AppSettings } from '../../shared/settings.js'

// 注册应用设置 IPC，Renderer 只通过安全 API 读写本地缓存。
export function registerSettingsIpc(): void {
  // 主进程启动时先应用持久化并发数，避免必须打开设置页后才生效。
  setMaxConcurrentTransferTasks(getSettings().connection.sftpMaxConcurrentTransfers)
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    const savedSettings = saveSettings(settings)

    setMaxConcurrentTransferTasks(savedSettings.connection.sftpMaxConcurrentTransfers)
    return savedSettings
  })
}
