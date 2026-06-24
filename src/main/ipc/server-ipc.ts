import { ipcMain } from 'electron'

import { createServer, deleteServer, listServers, updateServer } from '../storage/server-store.js'
import type { ServerInput, ServerUpdateInput } from '../../shared/server.js'

// 注册服务器管理 IPC，Renderer 只能通过这些方法访问本地存储。
export function registerServerIpc(): void {
  ipcMain.handle('server:list', () => listServers())

  ipcMain.handle('server:create', (_event, input: ServerInput) => createServer(input))

  ipcMain.handle('server:update', (_event, input: ServerUpdateInput) => updateServer(input))

  ipcMain.handle('server:delete', (_event, serverId: string) => {
    deleteServer(serverId)
    return true
  })
}
