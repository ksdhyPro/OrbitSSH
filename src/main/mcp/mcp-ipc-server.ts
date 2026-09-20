import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, rm, writeFile } from 'node:fs/promises'
import net, { type Server, type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import {
  ORBITSSH_MCP_DESCRIPTOR_FILE,
  ORBITSSH_MCP_PROTOCOL_VERSION,
  type OrbitSshMcpEndpointDescriptor,
  type OrbitSshMcpRequest,
  type OrbitSshMcpResponse
} from '../../shared/mcp.js'
import { ensureOrbitSshMcpRuntimeDirectory } from '../../shared/mcp-runtime.js'
import {
  executeMcpCommand,
  getMcpAccessStatus,
  listMcpConnections,
  OrbitSshMcpError
} from './mcp-command-service.js'

const MAX_REQUEST_BYTES = 128 * 1024

let ipcServer: Server | null = null
let activeDescriptor: OrbitSshMcpEndpointDescriptor | null = null
let activeDescriptorPath = ''

function createEndpoint(): string {
  const suffix = randomBytes(12).toString('hex')

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\orbitssh-mcp-${suffix}`
  }

  // Unix Domain Socket 使用短路径，避免 macOS 的 socket 路径长度限制。
  return path.join(os.tmpdir(), `orbitssh-mcp-${process.getuid?.() ?? 'user'}-${suffix}.sock`)
}

function serializeResponse(response: OrbitSshMcpResponse): string {
  return `${JSON.stringify(response)}\n`
}

function writeError(socket: Socket, requestId: string, error: unknown): void {
  const response: OrbitSshMcpResponse = {
    requestId,
    ok: false,
    error: {
      code: error instanceof OrbitSshMcpError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : String(error)
    }
  }
  socket.end(serializeResponse(response))
}

async function handleRequest(request: OrbitSshMcpRequest): Promise<unknown> {
  if (request.token !== activeDescriptor?.token) {
    throw new OrbitSshMcpError('UNAUTHORIZED', 'OrbitSSH MCP 会话认证失败')
  }

  switch (request.method) {
    case 'get_status':
      return getMcpAccessStatus()
    case 'list_connections':
      return listMcpConnections()
    case 'execute_command':
      return executeMcpCommand(request.params ?? {})
    default:
      throw new OrbitSshMcpError('METHOD_NOT_FOUND', '不支持的 OrbitSSH MCP 方法')
  }
}

function handleSocket(socket: Socket): void {
  let buffer = ''
  let handled = false

  socket.setEncoding('utf8')
  socket.on('data', chunk => {
    if (handled) return
    buffer += chunk

    if (Buffer.byteLength(buffer, 'utf8') > MAX_REQUEST_BYTES) {
      handled = true
      writeError(socket, '', new OrbitSshMcpError('REQUEST_TOO_LARGE', 'MCP 请求过大'))
      return
    }

    const newlineIndex = buffer.indexOf('\n')
    if (newlineIndex === -1) return
    handled = true

    let request: OrbitSshMcpRequest
    try {
      request = JSON.parse(buffer.slice(0, newlineIndex)) as OrbitSshMcpRequest
    } catch {
      writeError(socket, '', new OrbitSshMcpError('INVALID_JSON', 'MCP 请求格式无效'))
      return
    }

    void handleRequest(request)
      .then(result => {
        socket.end(serializeResponse({ requestId: request.requestId, ok: true, result }))
      })
      .catch(error => writeError(socket, request.requestId, error))
  })
  socket.on('error', () => {
    // 客户端中断连接时由 socket 自行释放，避免把命令或输出写入日志。
  })
}

async function removeRuntimeFiles(): Promise<void> {
  if (activeDescriptorPath) {
    await rm(activeDescriptorPath, { force: true }).catch(() => undefined)
  }
  if (activeDescriptor && process.platform !== 'win32') {
    await rm(activeDescriptor.endpoint, { force: true }).catch(() => undefined)
  }
}

export async function startMcpIpcServer(): Promise<void> {
  if (ipcServer) return

  const runtimeDirectory = await ensureOrbitSshMcpRuntimeDirectory()
  activeDescriptorPath = path.join(runtimeDirectory, ORBITSSH_MCP_DESCRIPTOR_FILE)
  await rm(activeDescriptorPath, { force: true }).catch(() => undefined)

  activeDescriptor = {
    version: ORBITSSH_MCP_PROTOCOL_VERSION,
    endpoint: createEndpoint(),
    token: randomBytes(32).toString('base64url'),
    pid: process.pid
  }

  ipcServer = net.createServer(handleSocket)
  await new Promise<void>((resolve, reject) => {
    ipcServer!.once('error', reject)
    ipcServer!.listen(activeDescriptor!.endpoint, () => {
      ipcServer!.removeListener('error', reject)
      resolve()
    })
  })

  if (process.platform !== 'win32') {
    await chmod(activeDescriptor.endpoint, 0o600)
  }

  await writeFile(activeDescriptorPath, JSON.stringify(activeDescriptor), {
    encoding: 'utf8',
    mode: 0o600
  })
}

export async function stopMcpIpcServer(): Promise<void> {
  const server = ipcServer
  ipcServer = null

  if (server) {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  await removeRuntimeFiles()
  activeDescriptor = null
}
