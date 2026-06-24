import SftpClient from 'ssh2-sftp-client'

import { writeAppLog } from '../logger.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import type {
  RemoteFileNode,
  SftpInitResult,
  SftpProbeTextResult,
  SftpReadTextResult
} from '../../shared/sftp.js'

interface SftpSession {
  tabId: string
  serverId: string
  client: SftpClient
  homePath: string
}

const sftpSessions = new Map<string, SftpSession>()
const textProbeSampleBytes = 8192
const maxEditableTextFileSize = 10 * 1024 * 1024

function normalizeRemotePath(path: string): string {
  const trimmedPath = path.trim()

  if (!trimmedPath) {
    return '.'
  }

  return trimmedPath.replace(/\/+/g, '/')
}

function getSftpSession(tabId: string): SftpSession {
  const session = sftpSessions.get(tabId)

  if (!session) {
    throw new Error('SFTP 会话不存在')
  }

  return session
}

function toRemoteFileNode(item: SftpClient.FileInfo, parentPath: string): RemoteFileNode {
  const normalizedParentPath = normalizeRemotePath(parentPath)
  const pathPrefix = normalizedParentPath.endsWith('/') ? normalizedParentPath : `${normalizedParentPath}/`
  const type = item.type === 'd' ? 'directory' : 'file'

  return {
    path: `${pathPrefix}${item.name}`,
    name: item.name,
    type,
    size: item.size,
    modifyTime: item.modifyTime,
    loaded: type === 'file'
  }
}

function sortRemoteNodes(nodes: RemoteFileNode[]): RemoteFileNode[] {
  return [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}

function readRemoteFileHead(session: SftpSession, remotePath: string, byteCount: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalLength = 0
    let settled = false
    const finish = (): void => {
      if (settled) {
        return
      }

      settled = true
      resolve(Buffer.concat(chunks, Math.min(totalLength, byteCount)))
    }
    const stream = session.client.createReadStream(remotePath, {
      start: 0,
      end: Math.max(byteCount - 1, 0)
    })

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(buffer)
      totalLength += buffer.length

      if (totalLength >= byteCount) {
        stream.destroy()
      }
    })
    stream.on('error', reject)
    stream.on('close', finish)
    stream.on('end', finish)
  })
}

function isLikelyUtf8(buffer: Buffer): boolean {
  return !buffer.toString('utf8').includes('\uFFFD')
}

function detectTextBuffer(buffer: Buffer): Pick<SftpProbeTextResult, 'isText' | 'reason'> {
  if (buffer.length === 0) {
    return { isText: true, reason: 'empty' }
  }

  if (buffer.includes(0)) {
    return { isText: false, reason: 'binary' }
  }

  const firstLine = buffer.toString('utf8', 0, Math.min(buffer.length, 256)).split(/\r?\n/, 1)[0]

  if (firstLine.startsWith('#!')) {
    return { isText: true, reason: 'shebang' }
  }

  let controlCount = 0

  for (const byte of buffer) {
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13 || byte === 27

    if (byte < 32 && !isAllowedControl) {
      controlCount += 1
    }
  }

  if (controlCount / buffer.length > 0.02 || !isLikelyUtf8(buffer)) {
    return { isText: false, reason: 'binary' }
  }

  return { isText: true, reason: 'text' }
}

export async function openSftpSession(tabId: string, serverId: string): Promise<SftpInitResult> {
  writeAppLog({
    scope: 'main.sftp',
    message: '开始创建 SFTP 会话',
    data: { tabId, serverId }
  })

  if (sftpSessions.has(tabId)) {
    writeAppLog({
      scope: 'main.sftp',
      message: '检测到旧 SFTP 会话，先关闭',
      data: { tabId }
    })
    await closeSftpSession(tabId)
  }

  const server = getServerAuthConfig(serverId)
  const client = new SftpClient(`sftp-${tabId}`)

  try {
    await client.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password,
      readyTimeout: 15000
    })
  } catch (error) {
    writeAppLog({
      scope: 'main.sftp',
      level: 'error',
      message: 'SFTP 连接失败',
      data: {
        tabId,
        serverId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
    throw error
  }

  const homePath = normalizeRemotePath(await client.cwd())
  const session: SftpSession = {
    tabId,
    serverId,
    client,
    homePath
  }

  sftpSessions.set(tabId, session)
  writeAppLog({
    scope: 'main.sftp',
    message: 'SFTP 会话创建成功',
    data: { tabId, serverId, homePath }
  })

  const nodes = await listRemoteDirectory(tabId, homePath)
  writeAppLog({
    scope: 'main.sftp',
    message: 'home 目录读取完成',
    data: { tabId, path: homePath, nodeCount: nodes.length }
  })

  return {
    homePath,
    nodes
  }
}

export async function listRemoteDirectory(tabId: string, path: string): Promise<RemoteFileNode[]> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  writeAppLog({
    scope: 'main.sftp',
    message: '开始读取远程目录',
    data: { tabId, path: normalizedPath }
  })

  const items = await session.client.list(normalizedPath)
  const nodes = items.map((item) => toRemoteFileNode(item, normalizedPath))

  writeAppLog({
    scope: 'main.sftp',
    message: '远程目录读取完成',
    data: {
      tabId,
      path: normalizedPath,
      itemCount: items.length,
      directoryCount: nodes.filter((node) => node.type === 'directory').length,
      fileCount: nodes.filter((node) => node.type === 'file').length
    }
  })

  return sortRemoteNodes(nodes)
}

export async function probeRemoteTextFile(
  tabId: string,
  path: string,
  size?: number
): Promise<SftpProbeTextResult> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)

  if (typeof size === 'number' && size > maxEditableTextFileSize) {
    return {
      path: normalizedPath,
      isText: false,
      reason: 'too-large',
      sampleSize: 0
    }
  }

  try {
    const sample = await readRemoteFileHead(session, normalizedPath, textProbeSampleBytes)
    const detection = detectTextBuffer(sample)

    writeAppLog({
      scope: 'main.sftp',
      message: '远程文件文本探测完成',
      data: {
        tabId,
        path: normalizedPath,
        isText: detection.isText,
        reason: detection.reason,
        sampleSize: sample.length
      }
    })

    return {
      path: normalizedPath,
      ...detection,
      sampleSize: sample.length
    }
  } catch (error) {
    writeAppLog({
      scope: 'main.sftp',
      level: 'warn',
      message: '远程文件文本探测失败',
      data: {
        tabId,
        path: normalizedPath,
        error: error instanceof Error ? error.message : String(error)
      }
    })

    return {
      path: normalizedPath,
      isText: false,
      reason: 'read-error',
      sampleSize: 0
    }
  }
}

export async function readRemoteTextFile(tabId: string, path: string): Promise<SftpReadTextResult> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  const data = await session.client.get(normalizedPath)
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data))

  if (buffer.length > maxEditableTextFileSize) {
    throw new Error('文件过大，暂不支持直接编辑')
  }

  const detection = detectTextBuffer(buffer.subarray(0, textProbeSampleBytes))

  if (!detection.isText) {
    throw new Error('该文件看起来不是文本文件')
  }

  writeAppLog({
    scope: 'main.sftp',
    message: '远程文本文件读取完成',
    data: { tabId, path: normalizedPath, size: buffer.length }
  })

  return {
    path: normalizedPath,
    content: buffer.toString('utf8'),
    encoding: 'utf8'
  }
}

export async function writeRemoteTextFile(tabId: string, path: string, content: string): Promise<boolean> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  const buffer = Buffer.from(content, 'utf8')

  await session.client.put(buffer, normalizedPath)
  writeAppLog({
    scope: 'main.sftp',
    message: '远程文本文件保存完成',
    data: { tabId, path: normalizedPath, size: buffer.length }
  })

  return true
}

export async function closeSftpSession(tabId: string): Promise<void> {
  const session = sftpSessions.get(tabId)

  if (!session) {
    return
  }

  sftpSessions.delete(tabId)
  await session.client.end()
  writeAppLog({
    scope: 'main.sftp',
    message: 'SFTP 会话已关闭',
    data: { tabId, serverId: session.serverId, homePath: session.homePath }
  })
}

export async function closeAllSftpSessions(): Promise<void> {
  await Promise.all([...sftpSessions.keys()].map((tabId) => closeSftpSession(tabId)))
}
