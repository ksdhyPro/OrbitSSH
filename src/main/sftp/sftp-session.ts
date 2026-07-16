import SftpClient from 'ssh2-sftp-client'
import type { WebContents } from 'electron'

import { extname } from 'node:path'

import { writeAppLog } from '../logger.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'
import { getIdleDisconnectMs, getSshKeepaliveIntervalMs } from '../ssh/connection-options.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { appConfig } from '../../shared/config.js'
import type {
  RemoteFileNode,
  SftpInitResult,
  SftpPreviewImageResult,
  SftpProbeTextResult,
  SftpReadTextResult
} from '../../shared/sftp.js'
import {
  deleteSftpSession,
  findSftpSession,
  getSftpSession,
  hasSftpSession,
  listSftpSessions,
  setSftpSession,
  type SftpSession
} from './sftp-session-registry.js'
import {
  closeRemoteHandle,
  getRawSftpClient,
  normalizeRemotePath,
  openRemoteWriteHandle
} from './sftp-transfer-common.js'

const { maxEditableFileSizeBytes, textProbeSampleBytes } = appConfig.sftp.textEditor
const idleDisconnectCheckIntervalMs = 30_000
const imageMimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
}

async function closeIdleSftpSessions(): Promise<void> {
  const idleDisconnectMs = getIdleDisconnectMs()

  if (idleDisconnectMs <= 0) {
    return
  }

  const now = Date.now()
  const idleSessions = listSftpSessions().filter(
    (session) => now - session.lastActiveAt >= idleDisconnectMs
  )

  await Promise.all(
    idleSessions.map(async (session) => {
      writeAppLog({
        scope: 'main.sftp',
        message: 'SFTP 会话因空闲超时关闭',
        data: {
          tabId: session.tabId,
          serverId: session.serverId,
          idleMs: now - session.lastActiveAt
        }
      })
      await closeSftpSession(session.tabId).catch((error) => {
        writeAppLog({
          scope: 'main.sftp',
          level: 'warn',
          message: '关闭空闲 SFTP 会话失败',
          data: {
            tabId: session.tabId,
            serverId: session.serverId,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      })
    })
  )
}

const sftpIdleDisconnectTimer = setInterval(() => {
  void closeIdleSftpSessions()
}, idleDisconnectCheckIntervalMs)
sftpIdleDisconnectTimer.unref?.()

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

export function assertSftpSessionAccess(
  tabId: string,
  webContents: WebContents,
  options: { allowMissing?: boolean } = {}
): void {
  if (typeof tabId !== 'string' || !tabId.trim()) {
    throw new Error('SFTP 会话 ID 无效')
  }

  const session = findSftpSession(tabId)

  if (!session) {
    if (options.allowMissing) {
      return
    }

    throw new Error('SFTP 会话不存在')
  }

  if (session.webContents !== webContents) {
    throw new Error('SFTP 会话不属于当前窗口')
  }
}

export async function openSftpSession(
  tabId: string,
  serverId: string,
  webContents: WebContents
): Promise<SftpInitResult> {
  const startedAt = Date.now()
  writeAppLog({
    scope: 'main.sftp',
    message: '开始创建 SFTP 会话',
    data: { tabId, serverId }
  })

  if (hasSftpSession(tabId)) {
    writeAppLog({
      scope: 'main.sftp',
      message: '检测到旧 SFTP 会话，先关闭',
      data: { tabId }
    })
    await closeSftpSession(tabId)
  }

  const server = getServerAuthConfig(serverId)
  const authLoadedAt = Date.now()
  const client = new SftpClient(`sftp-${tabId}`)

  try {
    await client.connect({
      ...createServerConnectOptions(server),
      readyTimeout: 15000,
      keepaliveInterval: getSshKeepaliveIntervalMs()
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

  const connectedAt = Date.now()
  const homePath = normalizeRemotePath(await client.cwd())
  const cwdLoadedAt = Date.now()
  const session: SftpSession = {
    tabId,
    serverId,
    webContents,
    client,
    homePath,
    lastActiveAt: Date.now()
  }

  setSftpSession(tabId, session)
  writeAppLog({
    scope: 'main.sftp',
    message: 'SFTP 会话创建成功',
    data: {
      tabId,
      serverId,
      homePath,
      authLoadMs: authLoadedAt - startedAt,
      connectMs: connectedAt - authLoadedAt,
      cwdMs: cwdLoadedAt - connectedAt,
      totalBeforeListMs: cwdLoadedAt - startedAt
    }
  })

  const nodes = await listRemoteDirectory(tabId, homePath)
  const listedAt = Date.now()
  writeAppLog({
    scope: 'main.sftp',
    message: 'home 目录读取完成',
    data: {
      tabId,
      path: homePath,
      nodeCount: nodes.length,
      listMs: listedAt - cwdLoadedAt,
      totalMs: listedAt - startedAt
    }
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

  if (typeof size === 'number' && size > maxEditableFileSizeBytes) {
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
  const stat = await session.client.stat(normalizedPath)
  const remoteSize = stat.size ?? 0

  if (remoteSize > maxEditableFileSizeBytes) {
    throw new Error('文件过大，暂不支持直接编辑')
  }

  const data = await session.client.get(normalizedPath)
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data))

  if (buffer.length > maxEditableFileSizeBytes) {
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

function getImageMimeType(fileName: string): string {
  const extension = extname(fileName).toLowerCase()

  return imageMimeTypes[extension] ?? 'application/octet-stream'
}

async function readRemoteFileBuffer(tabId: string, path: string): Promise<{ path: string; buffer: Buffer }> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  const data = await session.client.get(normalizedPath)

  return {
    path: normalizedPath,
    buffer: Buffer.isBuffer(data) ? data : Buffer.from(String(data))
  }
}

export async function previewRemoteImageFile(
  tabId: string,
  path: string,
  name: string,
  size?: number
): Promise<SftpPreviewImageResult> {
  if (typeof size === 'number' && size > appConfig.sftp.imagePreview.maxPreviewFileSizeBytes) {
    throw new Error('图片过大，暂不支持直接预览')
  }

  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  const stat = await session.client.stat(normalizedPath)
  const remoteSize = stat.size ?? 0

  if (remoteSize > appConfig.sftp.imagePreview.maxPreviewFileSizeBytes) {
    throw new Error('图片过大，暂不支持直接预览')
  }

  const result = await readRemoteFileBuffer(tabId, path)

  if (result.buffer.length > appConfig.sftp.imagePreview.maxPreviewFileSizeBytes) {
    throw new Error('图片过大，暂不支持直接预览')
  }

  const mimeType = getImageMimeType(name)
  writeAppLog({
    scope: 'main.sftp',
    message: '远程图片预览读取完成',
    data: { tabId, path: result.path, name, size: result.buffer.length, mimeType }
  })

  return {
    path: result.path,
    name,
    mimeType,
    dataUrl: `data:${mimeType};base64,${result.buffer.toString('base64')}`
  }
}

export async function writeRemoteTextFile(tabId: string, path: string, content: string): Promise<boolean> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  const buffer = Buffer.from(content, 'utf8')

  if (buffer.length > maxEditableFileSizeBytes) {
    throw new Error('文件过大，暂不支持直接保存')
  }

  await session.client.put(buffer, normalizedPath)
  writeAppLog({
    scope: 'main.sftp',
    message: '远程文本文件保存完成',
    data: { tabId, path: normalizedPath, size: buffer.length }
  })

  return true
}

export async function renameRemoteNode(
  tabId: string,
  path: string,
  newPath: string
): Promise<boolean> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  const normalizedNewPath = normalizeRemotePath(newPath)

  if (!normalizedNewPath || normalizedNewPath === '/' || normalizedNewPath === '.') {
    throw new Error('无效的新名称')
  }

  if (normalizedPath === normalizedNewPath) {
    return true
  }

  await session.client.rename(normalizedPath, normalizedNewPath)

  writeAppLog({
    scope: 'main.sftp',
    message: '远程文件节点重命名完成',
    data: { tabId, path: normalizedPath, newPath: normalizedNewPath }
  })

  return true
}

export async function createRemoteFile(tabId: string, path: string): Promise<boolean> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)

  if (!normalizedPath || normalizedPath === '/' || normalizedPath === '.') {
    throw new Error('无效的文件路径')
  }

  const rawSftp = getRawSftpClient(session.client)
  const handle = await openRemoteWriteHandle(rawSftp, normalizedPath, 'w')
  await closeRemoteHandle(rawSftp, handle)

  writeAppLog({
    scope: 'main.sftp',
    message: '远程文件创建完成',
    data: { tabId, path: normalizedPath }
  })

  return true
}

export async function createRemoteDirectory(tabId: string, path: string): Promise<boolean> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)

  if (!normalizedPath || normalizedPath === '/' || normalizedPath === '.') {
    throw new Error('无效的目录路径')
  }

  await session.client.mkdir(normalizedPath)

  writeAppLog({
    scope: 'main.sftp',
    message: '远程目录创建完成',
    data: { tabId, path: normalizedPath }
  })

  return true
}

export async function deleteRemoteNode(
  tabId: string,
  path: string,
  type: RemoteFileNode['type']
): Promise<boolean> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)

  if (normalizedPath === '.' || normalizedPath === '/') {
    throw new Error('不允许删除远程根目录')
  }

  if (type === 'directory') {
    // 文件树删除目录时使用递归删除，确保非空目录也能被清理。
    await session.client.rmdir(normalizedPath, true)
  } else {
    await session.client.delete(normalizedPath)
  }

  writeAppLog({
    scope: 'main.sftp',
    message: '远程文件节点删除完成',
    data: { tabId, path: normalizedPath, type }
  })

  return true
}

export async function closeSftpSession(tabId: string): Promise<void> {
  const session = findSftpSession(tabId)

  if (!session) {
    return
  }

  deleteSftpSession(tabId)
  await session.client.end()
  writeAppLog({
    scope: 'main.sftp',
    message: 'SFTP 会话已关闭',
    data: { tabId, serverId: session.serverId, homePath: session.homePath }
  })
}

export async function closeAllSftpSessions(): Promise<void> {
  await Promise.all(listSftpSessions().map((session) => closeSftpSession(session.tabId)))
}
