import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

import {
  ORBITSSH_MCP_DESCRIPTOR_FILE,
  ORBITSSH_MCP_PROTOCOL_VERSION,
  type OrbitSshMcpEndpointDescriptor,
  type OrbitSshMcpMethod,
  type OrbitSshMcpRequest,
  type OrbitSshMcpResponse
} from '../shared/mcp.js'

const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1024 * 1024

export class OrbitSshClientError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OrbitSshClientError'
  }
}

async function readEndpointDescriptor(
  userDataDirectory: string
): Promise<OrbitSshMcpEndpointDescriptor> {
  try {
    const content = await readFile(
      path.join(userDataDirectory, ORBITSSH_MCP_DESCRIPTOR_FILE),
      'utf8'
    )
    const descriptor = JSON.parse(content) as OrbitSshMcpEndpointDescriptor

    if (
      descriptor.version !== ORBITSSH_MCP_PROTOCOL_VERSION ||
      typeof descriptor.endpoint !== 'string' ||
      typeof descriptor.token !== 'string'
    ) {
      throw new Error('端点版本不匹配')
    }

    return descriptor
  } catch {
    throw new OrbitSshClientError('CLIENT_NOT_RUNNING', '请先打开 OrbitSSH 客户端')
  }
}

export async function callOrbitSsh(
  userDataDirectory: string,
  method: OrbitSshMcpMethod,
  params?: Record<string, unknown>,
  responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS
): Promise<unknown> {
  const descriptor = await readEndpointDescriptor(userDataDirectory)
  const request: OrbitSshMcpRequest = {
    requestId: randomUUID(),
    token: descriptor.token,
    method,
    params
  }

  return new Promise((resolve, reject) => {
    const socket = net.connect(descriptor.endpoint)
    let buffer = ''
    let settled = false

    const finish = (error?: Error, result?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }

    const timer = setTimeout(() => {
      finish(new OrbitSshClientError('CLIENT_TIMEOUT', 'OrbitSSH 客户端响应超时'))
    }, responseTimeoutMs)

    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
        finish(new OrbitSshClientError('RESPONSE_TOO_LARGE', 'OrbitSSH MCP 响应过大'))
        return
      }

      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) return

      try {
        const response = JSON.parse(buffer.slice(0, newlineIndex)) as OrbitSshMcpResponse
        if (!response.ok) {
          finish(
            new OrbitSshClientError(
              response.error?.code ?? 'ORBITSSH_ERROR',
              response.error?.message ?? 'OrbitSSH MCP 请求失败'
            )
          )
          return
        }
        finish(undefined, response.result)
      } catch {
        finish(new OrbitSshClientError('INVALID_RESPONSE', 'OrbitSSH MCP 响应格式无效'))
      }
    })
    socket.on('error', () => {
      finish(new OrbitSshClientError('CLIENT_NOT_RUNNING', '请先打开 OrbitSSH 客户端'))
    })
  })
}
