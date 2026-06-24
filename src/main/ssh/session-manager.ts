import type { WebContents } from 'electron'
import { Client, type ClientChannel } from 'ssh2'

import { writeAppLog } from '../logger.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import type { TerminalOpenResult, TerminalResizeInput, TerminalStatusEvent } from '../../shared/terminal.js'

interface TerminalSession {
  tabId: string
  serverId: string
  webContents: WebContents
  sshClient: Client
  shellStream?: ClientChannel
  status: TerminalStatusEvent['status']
}

const terminalSessions = new Map<string, TerminalSession>()

function sendStatus(session: TerminalSession, status: TerminalStatusEvent['status'], message?: string): void {
  session.status = status
  writeAppLog({
    scope: 'main.ssh',
    message: '终端状态变更',
    data: {
      tabId: session.tabId,
      serverId: session.serverId,
      status,
      message
    }
  })
  session.webContents.send('terminal:status', {
    tabId: session.tabId,
    status,
    message
  } satisfies TerminalStatusEvent)
}

function createSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'SSH 连接失败'
}

function createShellPathIntegrationCommand(): string {
  return [
    '__dockshell_emit_pwd(){ printf \'\\033]7;file://%s%s\\007\' "$HOSTNAME" "$PWD"; }',
    'if [ -n "$BASH_VERSION" ]; then PROMPT_COMMAND="__dockshell_emit_pwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi',
    'if [ -n "$ZSH_VERSION" ]; then precmd_functions+=(__dockshell_emit_pwd); fi',
    '__dockshell_emit_pwd'
  ].join('; ') + '\n'
}

function installShellPathIntegration(session: TerminalSession): void {
  if (!session.shellStream) {
    return
  }

  session.shellStream.write(createShellPathIntegrationCommand())
  writeAppLog({
    scope: 'main.ssh',
    message: '已注入终端路径同步脚本',
    data: { tabId: session.tabId, serverId: session.serverId }
  })
}

// 创建 SSH shell session，输入输出统一通过 IPC 转发给对应 Renderer。
export function openTerminalSession(webContents: WebContents, serverId: string): TerminalOpenResult {
  const server = getServerAuthConfig(serverId)
  const tabId = crypto.randomUUID()
  const sshClient = new Client()
  const session: TerminalSession = {
    tabId,
    serverId,
    webContents,
    sshClient,
    status: 'connecting'
  }

  terminalSessions.set(tabId, session)
  writeAppLog({
    scope: 'main.ssh',
    message: '开始创建 SSH 会话',
    data: { tabId, serverId, host: server.host, port: server.port, username: server.username }
  })
  sendStatus(session, 'connecting')

  sshClient
    .on('ready', () => {
      writeAppLog({
        scope: 'main.ssh',
        message: 'SSH 已 ready，开始打开 shell',
        data: { tabId, serverId }
      })
      sshClient.shell(
        {
          term: 'xterm-256color',
          cols: 80,
          rows: 24
        },
        (error, stream) => {
          if (error) {
            sendStatus(session, 'error', createSafeErrorMessage(error))
            closeTerminalSession(tabId)
            return
          }

          session.shellStream = stream
          writeAppLog({
            scope: 'main.ssh',
            message: 'SSH shell 已打开',
            data: { tabId, serverId }
          })
          sendStatus(session, 'connected')
          installShellPathIntegration(session)

          stream.on('data', (data: Buffer) => {
            webContents.send('terminal:data', {
              tabId,
              data: data.toString('utf8')
            })
          })

          stream.on('close', () => {
            sendStatus(session, 'disconnected')
            closeTerminalSession(tabId)
          })
        }
      )
    })
    .on('error', (error) => {
      writeAppLog({
        scope: 'main.ssh',
        level: 'error',
        message: 'SSH 会话错误',
        data: { tabId, serverId, error: createSafeErrorMessage(error) }
      })
      sendStatus(session, 'error', createSafeErrorMessage(error))
      closeTerminalSession(tabId)
    })
    .on('close', () => {
      if (terminalSessions.has(tabId)) {
        sendStatus(session, 'disconnected')
        terminalSessions.delete(tabId)
      }
    })

  sshClient.connect({
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
    readyTimeout: 15000,
    keepaliveInterval: 10000
  })

  return {
    tabId,
    serverId
  }
}

export function writeTerminalInput(tabId: string, data: string): void {
  const session = terminalSessions.get(tabId)

  if (!session?.shellStream || typeof data !== 'string') {
    return
  }

  session.shellStream.write(data)
}

export function resizeTerminal(input: TerminalResizeInput): void {
  const session = terminalSessions.get(input.tabId)

  if (!session?.shellStream) {
    return
  }

  if (!Number.isInteger(input.cols) || !Number.isInteger(input.rows)) {
    return
  }

  session.shellStream.setWindow(input.rows, input.cols, 0, 0)
}

export function closeTerminalSession(tabId: string): void {
  const session = terminalSessions.get(tabId)

  if (!session) {
    return
  }

  terminalSessions.delete(tabId)
  session.shellStream?.end()
  session.sshClient.end()
  writeAppLog({
    scope: 'main.ssh',
    message: 'SSH 会话已关闭',
    data: { tabId, serverId: session.serverId }
  })
}

export function closeAllTerminalSessions(): void {
  for (const tabId of terminalSessions.keys()) {
    closeTerminalSession(tabId)
  }
}
