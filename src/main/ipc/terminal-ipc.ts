import { ipcMain } from 'electron'

import {
  closeTerminalSession,
  openTerminalSession,
  reconnectTerminalSession,
  resizeTerminal,
  writeTerminalInput
} from '../ssh/session-manager.js'
import type { TerminalResizeInput } from '../../shared/terminal.js'
import {
  assertTabAccess,
  requireFiniteNumber,
  requireNonEmptyString,
  requireRecord,
  requireString
} from './validation.js'

// 注册终端 IPC，SSH 连接和 shell stream 只存在于 Main Process。
export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:open', (event, serverId: unknown) =>
    openTerminalSession(event.sender, requireNonEmptyString(serverId, '服务器 ID'))
  )

  ipcMain.handle('terminal:write', (event, tabId: unknown, data: unknown) => {
    const normalizedTabId = requireNonEmptyString(tabId, '终端标签页 ID')
    assertTabAccess(event, normalizedTabId)
    writeTerminalInput(normalizedTabId, requireString(data, '终端输入'))
    return true
  })

  ipcMain.handle('terminal:resize', (event, input: unknown) => {
    const record = requireRecord(input, '终端尺寸参数')
    const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
    const cols = Math.max(1, Math.floor(requireFiniteNumber(record.cols, '终端列数')))
    const rows = Math.max(1, Math.floor(requireFiniteNumber(record.rows, '终端行数')))
    assertTabAccess(event, tabId)
    resizeTerminal({ tabId, cols, rows } satisfies TerminalResizeInput)
    return true
  })

  ipcMain.handle('terminal:close', (event, tabId: unknown) => {
    const normalizedTabId = requireNonEmptyString(tabId, '终端标签页 ID')
    assertTabAccess(event, normalizedTabId, { allowMissing: true })
    closeTerminalSession(normalizedTabId)
    return true
  })

  ipcMain.handle('terminal:reconnect', (event, tabId: unknown, serverId?: unknown) => {
    const normalizedTabId = requireNonEmptyString(tabId, '终端标签页 ID')
    // 断开后主进程可能已清理旧会话，此时允许通过 serverId 恢复连接。
    assertTabAccess(event, normalizedTabId, { allowMissing: true })
    return reconnectTerminalSession(
      event.sender,
      normalizedTabId,
      serverId === undefined ? undefined : requireNonEmptyString(serverId, '服务器 ID')
    )
  }
  )
}
