import SftpClient from 'ssh2-sftp-client'

import { open as openLocalFile, rm, stat as statLocalFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { writeAppLog } from '../logger.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { appConfig } from '../../shared/config.js'
import type {
  RemoteFileNode,
  SftpDownloadProgressEvent,
  SftpInitResult,
  SftpPreviewImageResult,
  SftpProbeTextResult,
  SftpReadTextResult
} from '../../shared/sftp.js'

interface SftpSession {
  tabId: string
  serverId: string
  client: SftpClient
  homePath: string
}

interface RawSftpClient {
  open: (path: string, flags: string, callback: (error: Error | undefined, handle: Buffer) => void) => void
  read: (
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | undefined, bytesRead: number) => void
  ) => void
  close: (handle: Buffer, callback: (error?: Error) => void) => void
}

interface DownloadRuntimeTask {
  client: SftpClient
  localPath: string
  paused: boolean
  canceled: boolean
  emitProgress: (status: SftpDownloadProgressEvent['status'], error?: string) => void
}

const sftpSessions = new Map<string, SftpSession>()
const { maxEditableFileSizeBytes, textProbeSampleBytes } = appConfig.sftp.textEditor
const activeDownloadTasks = new Map<string, DownloadRuntimeTask>()
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

async function getLocalFileSize(path: string): Promise<number> {
  try {
    const stat = await statLocalFile(path)

    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

function getRawSftpClient(client: SftpClient): RawSftpClient {
  const rawSftp = (client as unknown as { sftp?: RawSftpClient }).sftp

  if (!rawSftp) {
    throw new Error('SFTP 连接尚未初始化')
  }

  return rawSftp
}

function openRemoteReadHandle(sftp: RawSftpClient, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, 'r', (error, handle) => {
      if (error) {
        reject(error)
        return
      }

      resolve(handle)
    })
  })
}

function closeRemoteHandle(sftp: RawSftpClient, handle: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.close(handle, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function readRemoteChunk(
  sftp: RawSftpClient,
  handle: Buffer,
  length: number,
  position: number
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)

  return new Promise((resolve, reject) => {
    sftp.read(handle, buffer, 0, length, position, (error, bytesRead) => {
      if (error) {
        reject(error)
        return
      }

      resolve(bytesRead === length ? buffer : buffer.subarray(0, bytesRead))
    })
  })
}

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
  const startedAt = Date.now()
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
  const authLoadedAt = Date.now()
  const client = new SftpClient(`sftp-${tabId}`)

  try {
    await client.connect({
      ...createServerConnectOptions(server),
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

  const connectedAt = Date.now()
  const homePath = normalizeRemotePath(await client.cwd())
  const cwdLoadedAt = Date.now()
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

  await session.client.put(buffer, normalizedPath)
  writeAppLog({
    scope: 'main.sftp',
    message: '远程文本文件保存完成',
    data: { tabId, path: normalizedPath, size: buffer.length }
  })

  return true
}

export async function controlRemoteDownloadTask(
  taskId: string,
  action: 'pause' | 'resume' | 'cancel',
  localPath?: string
): Promise<boolean> {
  const task = activeDownloadTasks.get(taskId)

  if (!task) {
    if (action === 'cancel' && localPath) {
      // 已暂停的任务不在活动连接表里，取消时仍需要清理保留的半成品文件。
      await rm(localPath, { force: true }).catch((error) => {
        writeAppLog({
          scope: 'main.sftp',
          level: 'warn',
          message: '取消暂停任务时清理本地文件失败',
          data: { taskId, localPath, error: error instanceof Error ? error.message : String(error) }
        })
      })

      return true
    }

    return false
  }

  if (action === 'pause') {
    task.paused = true
    task.emitProgress('paused')
    // 暂停通过关闭当前下载专用连接实现，避免在 fastGet 回调里抛异常导致主进程崩溃。
    await task.client.end().catch((error) => {
      writeAppLog({
        scope: 'main.sftp',
        level: 'warn',
        message: '暂停下载时关闭连接失败',
        data: { taskId, error: error instanceof Error ? error.message : String(error) }
      })
    })
    return true
  }

  if (action === 'resume') {
    task.paused = false
    task.emitProgress('progress')
    return true
  }

  task.canceled = true
  task.emitProgress('canceled')
  // 取消同样只负责中断连接，最终状态和临时文件清理由下载流程统一收口。
  await task.client.end().catch((error) => {
    writeAppLog({
      scope: 'main.sftp',
      level: 'warn',
      message: '取消下载时关闭连接失败',
      data: { taskId, error: error instanceof Error ? error.message : String(error) }
    })
  })
  return true
}

export async function downloadRemoteFile(
  tabId: string,
  path: string,
  localPath: string,
  task: Pick<SftpDownloadProgressEvent, 'taskId' | 'name'>,
  totalBytes?: number,
  onProgress?: (event: SftpDownloadProgressEvent) => void
): Promise<boolean> {
  const session = getSftpSession(tabId)
  const normalizedPath = normalizeRemotePath(path)
  const server = getServerAuthConfig(session.serverId)
  const downloadClient = new SftpClient(`download-${task.taskId}`)
  let total = totalBytes ?? 0

  if (typeof totalBytes !== 'number') {
    const stat = await session.client.stat(normalizedPath)
    total = stat.size ?? 0
  }

  const startedAt = Date.now()
  let transferredBytes = 0
  let lastProgressAt = 0
  let lastSpeedAt = startedAt
  let lastSpeedBytes = 0
  let currentSpeedBytesPerSecond = 0
  let wasCanceled = false
  let wasPaused = false

  const emitProgress = (status: SftpDownloadProgressEvent['status']): void => {
    const now = Date.now()

    if (status === 'progress') {
      const elapsedSeconds = Math.max((now - lastSpeedAt) / 1000, 0.001)
      currentSpeedBytesPerSecond = Math.max((transferredBytes - lastSpeedBytes) / elapsedSeconds, 0)
      lastSpeedAt = now
      lastSpeedBytes = transferredBytes
    }

    onProgress?.({
      taskId: task.taskId,
      tabId,
      name: task.name,
      path: normalizedPath,
      status,
      transferredBytes,
      totalBytes: total,
      speedBytesPerSecond: status === 'started' ? 0 : currentSpeedBytesPerSecond,
      filePath: localPath
    })
  }
  const downloadTask = {
    client: downloadClient,
    localPath,
    paused: false,
    canceled: false,
    emitProgress: (status: SftpDownloadProgressEvent['status']) => emitProgress(status)
  }

  activeDownloadTasks.set(task.taskId, downloadTask)

  try {
    const localSize = await getLocalFileSize(localPath)

    if (localSize > 0 && total > 0 && localSize >= total) {
      transferredBytes = total
      emitProgress('completed')
      return true
    }

    // 本地已有半成品时从对应偏移继续读取，避免暂停后再次从 0 覆盖下载。
    const resumeOffset = total > 0 ? Math.min(localSize, total) : localSize
    transferredBytes = resumeOffset
    lastSpeedBytes = resumeOffset

    await downloadClient.connect({
      ...createServerConnectOptions(server),
      readyTimeout: 15000
    })

    if (resumeOffset > 0) {
      const rawSftp = getRawSftpClient(downloadClient)
      const remoteHandle = await openRemoteReadHandle(rawSftp, normalizedPath)
      const localFile = await openLocalFile(localPath, 'r+')
      let nextReadPosition = resumeOffset

      try {
        const readRemainingChunks = async (): Promise<void> => {
          while (!downloadTask.paused && !downloadTask.canceled && nextReadPosition < total) {
            const readPosition = nextReadPosition
            const readLength = Math.min(appConfig.sftp.download.fastGetChunkSizeBytes, total - readPosition)
            nextReadPosition += readLength
            const chunk = await readRemoteChunk(rawSftp, remoteHandle, readLength, readPosition)

            if (chunk.length === 0) {
              return
            }

            // 并发分片按远程偏移写回本地，保证续传不会从 0 覆盖已有内容。
            await localFile.write(chunk, 0, chunk.length, readPosition)
            transferredBytes += chunk.length

            const now = Date.now()
            if (now - lastProgressAt >= appConfig.sftp.download.progressIntervalMs) {
              lastProgressAt = now
              emitProgress('progress')
            }
          }
        }

        await Promise.all(
          Array.from({ length: appConfig.sftp.download.fastGetConcurrency }, () => readRemainingChunks())
        )
      } finally {
        await closeRemoteHandle(rawSftp, remoteHandle).catch(() => undefined)
        await localFile.close().catch(() => undefined)
      }
    } else {
      await downloadClient.fastGet(normalizedPath, localPath, {
        concurrency: appConfig.sftp.download.fastGetConcurrency,
        chunkSize: appConfig.sftp.download.fastGetChunkSizeBytes,
        step: (totalTransferred) => {
          const now = Date.now()
          transferredBytes = totalTransferred

          if (now - lastProgressAt >= appConfig.sftp.download.progressIntervalMs) {
            lastProgressAt = now
            emitProgress('progress')
          }
        }
      })
    }

    if (downloadTask.canceled) {
      wasCanceled = true
    } else if (downloadTask.paused) {
      wasPaused = true
    } else {
      transferredBytes = total > 0 ? total : transferredBytes
      emitProgress('completed')
    }
  } catch (error) {
    if (downloadTask.canceled) {
      wasCanceled = true
    } else if (downloadTask.paused) {
      wasPaused = true
    } else {
      throw error
    }
  } finally {
    const isCurrentTask = activeDownloadTasks.get(task.taskId) === downloadTask

    if (isCurrentTask) {
      activeDownloadTasks.delete(task.taskId)
    }
    await downloadClient.end().catch(() => undefined)

    if (isCurrentTask && wasCanceled) {
      try {
        await rm(localPath, { force: true })
      } catch (error) {
        writeAppLog({
          scope: 'main.sftp',
          level: 'warn',
          message: '下载中断后清理本地文件失败',
          data: { taskId: task.taskId, localPath, error: error instanceof Error ? error.message : String(error) }
        })
      }
    }

    if (isCurrentTask && (wasCanceled || wasPaused)) {
      // 最终状态再补发一次，保证快速关闭连接后任务面板能保持正确状态。
      emitProgress(wasPaused ? 'paused' : 'canceled')
    }
  }

  if (wasPaused) {
    return false
  }

  if (wasCanceled) {
    writeAppLog({
      scope: 'main.sftp',
      message: '远程文件下载已取消',
      data: { tabId, path: normalizedPath, localPath, size: transferredBytes }
    })

    return false
  }

  writeAppLog({
    scope: 'main.sftp',
    message: '远程文件下载完成',
    data: { tabId, path: normalizedPath, localPath, size: transferredBytes }
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
