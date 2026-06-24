import { ipcMain } from 'electron'

import { closeSftpSession, listRemoteDirectory, openSftpSession } from '../sftp/sftp-manager.js'
import type { SftpListInput } from '../../shared/sftp.js'

// 注册 SFTP IPC，目录读取和连接信息全部留在 Main Process。
export function registerSftpIpc(): void {
  ipcMain.handle('sftp:open', (_event, tabId: string, serverId: string) => openSftpSession(tabId, serverId))

  ipcMain.handle('sftp:list', (_event, input: SftpListInput) => listRemoteDirectory(input.tabId, input.path))

  ipcMain.handle('sftp:close', async (_event, tabId: string) => {
    await closeSftpSession(tabId)
    return true
  })
}
