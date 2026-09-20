import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

import { getOrbitSshMcpRuntimeDirectory } from '../shared/mcp-runtime.js'
import { callOrbitSsh, OrbitSshClientError } from './orbitssh-client.js'

function toToolError(error: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  const message =
    error instanceof OrbitSshClientError || error instanceof Error
      ? error.message
      : String(error)

  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

function toTextResult(result: unknown): {
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  }
}

export function startOrbitSshMcpServer(): void {
  const runtimeDirectory = getOrbitSshMcpRuntimeDirectory()
  void serveStdio(() => {
    const server = new McpServer(
      { name: 'orbitssh', version: '1.0.0' },
      {
        instructions:
          'OrbitSSH 必须正在运行且已在“设置 → AI”中开启 MCP 访问。先获取状态和连接列表，再使用连接 ID 执行命令。凭据由 OrbitSSH 内部使用，不会提供给调用方。'
      }
    )

    server.registerTool(
      'get_status',
      {
        title: '检查 OrbitSSH 状态',
        description: '检查 OrbitSSH 客户端是否正在运行以及 MCP 访问开关是否开启。',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false }
      },
      async () => {
        try {
          return toTextResult(await callOrbitSsh(runtimeDirectory, 'get_status'))
        } catch (error) {
          return toToolError(error)
        }
      }
    )

    server.registerTool(
      'list_connections',
      {
        title: '列出 OrbitSSH 连接',
        description: '列出允许通过 OrbitSSH 使用的已保存连接，仅返回连接 ID 和显示名称。',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false }
      },
      async () => {
        try {
          return toTextResult(await callOrbitSsh(runtimeDirectory, 'list_connections'))
        } catch (error) {
          return toToolError(error)
        }
      }
    )

    server.registerTool(
      'execute_command',
      {
        title: '通过 OrbitSSH 执行远程命令',
        description:
          '使用指定的已保存连接执行远程 Shell 命令。OrbitSSH 不对命令内容应用内置 AI 风险策略或逐条审批。',
        inputSchema: z.object({
          connectionId: z.string().min(1).describe('list_connections 返回的连接 ID'),
          command: z.string().min(1).max(100_000).describe('要原样执行的远程 Shell 命令'),
          workingDirectory: z.string().min(1).optional().describe('可选的远程工作目录'),
          timeoutMs: z.number().int().min(1_000).max(3_600_000).optional()
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true
        }
      },
      async ({ connectionId, command, workingDirectory, timeoutMs }) => {
        try {
          const waitMs = (timeoutMs ?? 60_000) + 10_000
          return toTextResult(
            await callOrbitSsh(
              runtimeDirectory,
              'execute_command',
              { connectionId, command, workingDirectory, timeoutMs },
              waitMs
            )
          )
        } catch (error) {
          return toToolError(error)
        }
      }
    )

    return server
  })
}
