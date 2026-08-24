import { getServerAuthConfig, listServers } from '../storage/server-store.js'
import { executeSshTerminalCommand } from '../ssh/terminal-command.js'
import { createSshClient } from '../sftp/sftp-transfer-common.js'
import type { AiCommandResult } from '../../shared/ai.js'

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

/**
 * 仅通过本地已保存的连接执行远端查询；模型永远不会接触认证信息，
 * 也不会借用当前终端作为跳板执行 ssh/scp。
 */
export async function executeSavedServerReadonlyCommand(
  serverReference: string,
  command: string,
  signal?: AbortSignal
): Promise<{ serverName: string; result: AiCommandResult }> {
  const serverId = resolveSavedServerId(serverReference)
  const server = getServerAuthConfig(serverId)
  const client = await createSshClient(server)

  try {
    const result = await executeSshTerminalCommand(client, command, 20_000, signal)
    return { serverName: server.name, result }
  } finally {
    client.end()
  }
}
