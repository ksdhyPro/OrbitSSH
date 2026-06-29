import { ipcMain } from 'electron'

import {
  closeTerminalSession,
  openTerminalSession,
  reconnectTerminalSession,
  resizeTerminal,
  writeTerminalInput
} from '../ssh/session-manager.js'
import type { TerminalResizeInput } from '../../shared/terminal.js'

// 注册终端 IPC，SSH 连接和 shell stream 只存在于 Main Process。
export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:open', (event, serverId: string) => openTerminalSession(event.sender, serverId))

  ipcMain.handle('terminal:write', (_event, tabId: string, data: string) => {
    writeTerminalInput(tabId, data)
    return true
  })

  ipcMain.handle('terminal:resize', (_event, input: TerminalResizeInput) => {
    resizeTerminal(input)
    return true
  })

  ipcMain.handle('terminal:close', (_event, tabId: string) => {
    closeTerminalSession(tabId)
    return true
  })

  ipcMain.handle('terminal:reconnect', (event, tabId: string, serverId?: string) =>
    reconnectTerminalSession(event.sender, tabId, serverId)
  )
}
