import { ipcMain } from 'electron'

import { createServer, createServerAutomationTask, createServerGroup, deleteServer, deleteServerGroup, listServerAutomationTasks, listServerGroups, listServers, setServerPinned, updateServer, updateServerAppearance, updateServerGroup } from '../storage/server-store.js'
import type { ServerAppearanceInput, ServerAutomationTaskInput, ServerGroupInput, ServerGroupUpdateInput, ServerInput, ServerPinInput, ServerUpdateInput } from '../../shared/server.js'

// 注册服务器管理 IPC，Renderer 只能通过这些方法访问本地存储。
export function registerServerIpc(): void {
  ipcMain.handle('server:list', () => listServers())

  ipcMain.handle('server:create', (_event, input: ServerInput) => createServer(input))

  ipcMain.handle('server:update', (_event, input: ServerUpdateInput) => updateServer(input))

  ipcMain.handle('server:set-pinned', (_event, input: ServerPinInput) => setServerPinned(input))

  ipcMain.handle('server:set-appearance', (_event, input: ServerAppearanceInput) => updateServerAppearance(input))
  ipcMain.handle('server:groups:list', () => listServerGroups())
  ipcMain.handle('server:groups:create', (_event, input: ServerGroupInput) => createServerGroup(input))
  ipcMain.handle('server:groups:update', (_event, input: ServerGroupUpdateInput) => updateServerGroup(input))
  ipcMain.handle('server:groups:delete', (_event, groupId: string) => {
    deleteServerGroup(groupId)
    return true
  })

  ipcMain.handle('server:automation-tasks:list', (_event, serverId: string) => listServerAutomationTasks(serverId))

  ipcMain.handle('server:automation-tasks:create', (_event, input: ServerAutomationTaskInput) => createServerAutomationTask(input))

  ipcMain.handle('server:delete', (_event, serverId: string) => {
    deleteServer(serverId)
    return true
  })
}
