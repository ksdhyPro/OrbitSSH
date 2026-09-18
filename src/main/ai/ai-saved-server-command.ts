import { getServerAuthConfig, listServers } from '../storage/server-store.js'
import { getSettings } from '../storage/settings-store.js'
import { executeSshTerminalCommand } from '../ssh/terminal-command.js'
import { createSshClient } from '../sftp/sftp-transfer-common.js'
import type { AiCommandResult, AiMode } from '../../shared/ai.js'
import {
  CROSS_SERVER_OPERATIONS_DISABLED_MESSAGE,
  CROSS_SERVER_OPERATIONS_DISABLED_REASON,
  resolveSavedServerCommandPermission
} from './ai-permission-policy.js'
import { evaluateAiCommand } from './command-policy.js'

function normalizeServerReference(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '').replace(/服务器|server/g, '')
}

function resolveSavedServerId(serverReference: string): string {
  const normalizedReference = normalizeServerReference(serverReference)
  if (!normalizedReference) {
    throw new Error('服务器名称不能为空')
  }
  const matches = listServers().filter(server => {
    const name = normalizeServerReference(server.name)
    const host = normalizeServerReference(server.host)
    return name === normalizedReference || host === normalizedReference || name.includes(normalizedReference)
  })

  if (matches.length === 0) {
    throw new Error(`未找到已保存的服务器“${serverReference}”`)
  }
  if (matches.length > 1) {
    throw new Error(`服务器“${serverReference}”匹配多个连接：${matches.map(server => server.name).join('、')}，请使用完整名称`)
  }

  return matches[0]!.id
}

interface ExecuteSavedServerCommandInput {
  serverReference: string
  command: string
  mode: AiMode
  risk: 'low' | 'medium' | 'high'
  approvalGranted?: boolean
  signal?: AbortSignal
}

/**
 * 仅通过本地已保存连接执行远端命令；模型不会接触认证信息，也不能借当前终端跳板。
 * 适配器在连接前再次校验三档权限，防止未来编排改动绕过审批接口。
 */
export async function executeSavedServerCommand(
  input: ExecuteSavedServerCommandInput
): Promise<{ serverName: string; result: AiCommandResult }> {
  const policy = evaluateAiCommand(input.command)
  const permission = resolveSavedServerCommandPermission(
    // 建立连接前读取最新设置，防止审批期间关闭开关后继续执行。
    getSettings().ai.allowCrossServerOperations,
    input.mode,
    input.risk,
    policy,
    input.approvalGranted ?? false
  )
  if (permission.decision !== 'execute') {
    if (permission.reason === CROSS_SERVER_OPERATIONS_DISABLED_REASON) {
      throw new Error(CROSS_SERVER_OPERATIONS_DISABLED_MESSAGE)
    }
    throw new Error(`跨服务器命令未获得执行权限：${permission.reason}`)
  }

  const serverId = resolveSavedServerId(input.serverReference)
  const server = getServerAuthConfig(serverId)
  const client = await createSshClient(server)

  try {
    const result = await executeSshTerminalCommand(
      client,
      input.command,
      20_000,
      input.signal
    )
    return { serverName: server.name, result }
  } finally {
    client.end()
  }
}
