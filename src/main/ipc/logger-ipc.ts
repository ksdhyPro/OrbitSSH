import { ipcMain } from 'electron'

import { getAppLogPath, writeAppLog } from '../logger.js'
import type { LogPayload } from '../../shared/logger.js'

function isLogPayload(payload: unknown): payload is LogPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<LogPayload>

  return typeof candidate.scope === 'string' && typeof candidate.message === 'string'
}

// 接收 Renderer 日志并统一落盘。
export function registerLoggerIpc(): void {
  ipcMain.handle('logger:write', (_event, payload: LogPayload) => {
    if (!isLogPayload(payload)) {
      return false
    }

    writeAppLog(payload)
    return true
  })

  ipcMain.handle('logger:get-path', () => getAppLogPath())
}
