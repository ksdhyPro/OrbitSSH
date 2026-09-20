import { getSettings } from '../storage/settings-store.js'
import { getServerAuthConfig, listServers } from '../storage/server-store.js'
import { createSshClient } from '../sftp/sftp-transfer-common.js'
import { executeSshTerminalCommand } from '../ssh/terminal-command.js'
import type {
  OrbitSshMcpCommandResult,
  OrbitSshMcpConnectionSummary
} from '../../shared/mcp.js'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 60 * 60 * 1_000
const MAX_COMMAND_LENGTH = 100_000

export class OrbitSshMcpError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OrbitSshMcpError'
  }
}

function assertMcpAccessEnabled(): void {
  if (!getSettings().ai.allowMcpAccess) {
    throw new OrbitSshMcpError(
      'MCP_ACCESS_DISABLED',
      '请先在 OrbitSSH 客户端的“设置 → AI”中开启“允许第三方 AI 通过 MCP 访问”'
    )
  }
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OrbitSshMcpError('INVALID_ARGUMENT', `${fieldName}不能为空`)
  }

  return value.trim()
}

function normalizeTimeoutMs(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS

  const timeoutMs = Number(value)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new OrbitSshMcpError(
      'INVALID_ARGUMENT',
      `timeoutMs 必须是 1000 到 ${MAX_TIMEOUT_MS} 之间的整数`
    )
  }

  return timeoutMs
}

export function getMcpAccessStatus(): { available: boolean; message: string } {
  const available = getSettings().ai.allowMcpAccess

  return {
    available,
    message: available
      ? 'OrbitSSH 客户端已连接，MCP 访问已开启'
      : '请先在 OrbitSSH 客户端的“设置 → AI”中开启“允许第三方 AI 通过 MCP 访问”'
  }
}

export function listMcpConnections(): OrbitSshMcpConnectionSummary[] {
  assertMcpAccessEnabled()

  // MCP 只暴露连接标识和显示名称，不序列化密码索引、私钥路径或认证信息。
  return listServers().map(server => ({
    id: server.id,
    name: server.name
  }))
}

/**
 * 使用已保存凭据执行第三方 MCP 命令。
 * 此入口按产品约定不套用内置 AI 命令策略或逐条审批，开关本身即为完整授权边界。
 */
export async function executeMcpCommand(
  params: Record<string, unknown>
): Promise<OrbitSshMcpCommandResult> {
  assertMcpAccessEnabled()

  const connectionId = normalizeRequiredString(params.connectionId, 'connectionId')
  const command = normalizeRequiredString(params.command, 'command')
  const workingDirectory =
    typeof params.workingDirectory === 'string' && params.workingDirectory.trim()
      ? params.workingDirectory.trim()
      : undefined
  const timeoutMs = normalizeTimeoutMs(params.timeoutMs)

  // 仅保留传输层输入边界，不分析或限制命令内容。
  if (command.includes('\0') || command.length > MAX_COMMAND_LENGTH) {
    throw new OrbitSshMcpError(
      'INVALID_ARGUMENT',
      `命令不能包含空字符且长度不能超过 ${MAX_COMMAND_LENGTH} 个字符`
    )
  }

  const server = getServerAuthConfig(connectionId)
  const client = await createSshClient(server)

  try {
    const result = await executeSshTerminalCommand(
      client,
      command,
      timeoutMs,
      undefined,
      workingDirectory
    )

    return {
      connectionId,
      connectionName: server.name,
      ...result
    }
  } finally {
    client.end()
  }
}
