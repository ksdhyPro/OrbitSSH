import { ipcMain } from 'electron'

import { createPortForwardRule, createServer, createServerAutomationTask, createServerGroup, deletePortForwardRule, deleteServer, deleteServerGroup, getPortForwardRule, listPortForwardRules, listServerAutomationTasks, listServerGroups, listServers, setServerPinned, updatePortForwardRule, updateServer, updateServerAppearance, updateServerGroup } from '../storage/server-store.js'
import type { ServerAppearanceInput, ServerAutomationTaskInput, ServerGroupInput, ServerGroupUpdateInput, ServerInput, ServerPinInput, ServerUpdateInput } from '../../shared/server.js'
import type { PortForwardRuleInput, PortForwardRuleUpdateInput } from '../../shared/port-forward.js'
import { getPortForwardRuntimes, isPortForwardRunning, startPortForward, stopPortForward } from '../ssh/port-forward-manager.js'

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

  ipcMain.handle('port-forward:list', (_event, serverId: string) => listPortForwardRules(serverId))
  ipcMain.handle('port-forward:runtimes', (_event, serverId: string) => getPortForwardRuntimes(serverId))
  ipcMain.handle('port-forward:create', (_event, input: PortForwardRuleInput) => createPortForwardRule(input))
  ipcMain.handle('port-forward:update', (_event, input: PortForwardRuleUpdateInput) => {
    if (isPortForwardRunning(input.id)) throw new Error('运行中的端口转发不能编辑')
    return updatePortForwardRule(input)
  })
  ipcMain.handle('port-forward:start', (event, ruleId: string) => {
    startPortForward(event.sender, getPortForwardRule(ruleId))
    return true
  })
  ipcMain.handle('port-forward:stop', (_event, ruleId: string) => stopPortForward(ruleId))
  ipcMain.handle('port-forward:delete', (_event, ruleId: string) => {
    if (isPortForwardRunning(ruleId)) throw new Error('运行中的端口转发不能删除')
    deletePortForwardRule(ruleId)
    return true
  })

  ipcMain.handle('server:delete', (_event, serverId: string) => {
    for (const rule of listPortForwardRules(serverId)) stopPortForward(rule.id)
    deleteServer(serverId)
    return true
  })
}
