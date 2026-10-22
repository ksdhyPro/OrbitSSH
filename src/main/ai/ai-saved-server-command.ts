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
import {
  assertSavedServerTargetUnchanged,
  resolveSavedServerTarget,
  type SavedServerTarget
} from './ai-saved-server-target.js'
import { evaluateAiCommand } from './command-policy.js'

/** 在展示审批卡之前解析模型提到的服务器，让用户确认的就是实际执行的目标。 */
export function resolveSavedServerTargetFromStore(serverReference: string): SavedServerTarget {
  return resolveSavedServerTarget(serverReference, listServers())
}

interface ExecuteSavedServerCommandInput {
  target: SavedServerTarget
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

  // 按审批时确定的服务器 ID 连接，不再按名称重新匹配。
  const server = getServerAuthConfig(input.target.id)
  assertSavedServerTargetUnchanged(input.target, server)
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
