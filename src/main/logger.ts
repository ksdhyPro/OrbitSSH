import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { LogLevel, LogPayload } from '../shared/logger.js'

const logFileName = 'dockshell.log'
let consoleEncodingConfigured = false

function configureConsoleEncoding(): void {
  if (consoleEncodingConfigured || process.platform !== 'win32') {
    return
  }

  consoleEncodingConfigured = true
  process.stdout.setDefaultEncoding('utf8')
  process.stderr.setDefaultEncoding('utf8')

  try {
    execFileSync('chcp.com', ['65001'], { stdio: 'ignore' })
  } catch {
    // GUI launches may not have an attached console; file logging is still UTF-8.
  }
}

function getLogFilePath(): string {
  return path.join(app.getPath('userData'), 'logs', logFileName)
}

function serializeData(data?: Record<string, unknown>): string {
  if (!data) {
    return ''
  }

  try {
    return ` ${JSON.stringify(data)}`
  } catch {
    return ' {"serializeError":"日志数据序列化失败"}'
  }
}

function writeLogLine(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): void {
  configureConsoleEncoding()
  const logLine = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}${serializeData(data)}`
  const logFilePath = getLogFilePath()

  fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
  fs.appendFileSync(logFilePath, `${logLine}\n`, 'utf8')

  if (level === 'error') {
    console.error(logLine)
    return
  }

  if (level === 'warn') {
    console.warn(logLine)
    return
  }

  console.log(logLine)
}

// 统一写日志，避免业务代码直接处理文件路径和序列化细节。
export function writeAppLog(payload: LogPayload): void {
  writeLogLine(payload.level ?? 'info', payload.scope, payload.message, payload.data)
}

export function getAppLogPath(): string {
  return getLogFilePath()
}
