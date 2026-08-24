import SftpClient from 'ssh2-sftp-client'

import { mkdir, open as openLocalFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { writeAppLog } from '../logger.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'
import { getSshKeepaliveIntervalMs } from '../ssh/connection-options.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { appConfig } from '../../shared/config.js'
import type { SftpDownloadProgressEvent } from '../../shared/sftp.js'
import { getSftpSession } from './sftp-session-registry.js'
import {
  closeRemoteHandle,
  getLocalFileSize,
  getRawSftpClient,
  getTransferTempPath,
  normalizeRemotePath,
  openRemoteReadHandle,
  readRemoteChunk,
  replaceLocalFile
} from './sftp-transfer-common.js'

interface DownloadRuntimeTask {
  client: SftpClient
  localPath: string
  paused: boolean
  canceled: boolean
  emitProgress: (status: SftpDownloadProgressEvent['status'], error?: string) => void
}

interface RemoteDownloadEntry {
  remotePath: string
  relativePath: string
  type: 'file' | 'directory'
  size: number
}

interface DirectoryDownloadRuntimeTask {
  currentTaskId?: string
  paused: boolean
  canceled: boolean
  resume?: () => void
}

const activeDownloadTasks = new Map<string, DownloadRuntimeTask>()
const activeDirectoryDownloadTasks = new Map<string, DirectoryDownloadRuntimeTask>()

export async function controlRemoteDownloadTask(
  taskId: string,
  action: 'pause' | 'resume' | 'cancel',
  localPath?: string
): Promise<boolean> {
  const directoryTask = activeDirectoryDownloadTasks.get(taskId)

  if (directoryTask) {
    if (action === 'pause') {
      directoryTask.paused = true
      if (directoryTask.currentTaskId) {
        await controlRemoteDownloadTask(directoryTask.currentTaskId, 'pause')
      }
      return true
    }

    if (action === 'resume') {
      directoryTask.paused = false
      directoryTask.resume?.()
      directoryTask.resume = undefined
      return true
    }

    directoryTask.canceled = true
    directoryTask.paused = false
    directoryTask.resume?.()
    directoryTask.resume = undefined
    if (directoryTask.currentTaskId) {
      await controlRemoteDownloadTask(directoryTask.currentTaskId, 'cancel')
    }
    return true
  }

  const task = activeDownloadTasks.get(taskId)

  if (!task) {
    if (action === 'cancel' && localPath) {
      // 已暂停的任务不在活动连接表里，取消时仍需要清理保留的半成品文件。
      await rm(getTransferTempPath(localPath), { force: true }).catch((error) => {
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

function createSafeRelativePath(parentPath: string, name: string): string {
  // 远端返回的条目名必须是单一文件名，避免构造本地路径时越出用户选择的目录。
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('远程目录包含不安全的文件名，已停止下载')
  }

  return parentPath ? `${parentPath}/${name}` : name
}

async function collectRemoteDownloadEntries(
  tabId: string,
  remotePath: string,
  relativePath: string,
  entries: RemoteDownloadEntry[]
): Promise<void> {
  const session = getSftpSession(tabId)
  const children = await session.client.list(remotePath)

  for (const child of children) {
    const childRelativePath = createSafeRelativePath(relativePath, child.name)
    const childRemotePath = `${normalizeRemotePath(remotePath).replace(/\/$/, '')}/${child.name}`

    if (child.type === 'd') {
      entries.push({ remotePath: childRemotePath, relativePath: childRelativePath, type: 'directory', size: 0 })
      await collectRemoteDownloadEntries(tabId, childRemotePath, childRelativePath, entries)
      continue
    }

    entries.push({
      remotePath: childRemotePath,
      relativePath: childRelativePath,
      type: 'file',
      size: child.size ?? 0
    })
  }
}

function waitForDirectoryDownloadResume(task: DirectoryDownloadRuntimeTask): Promise<void> {
  return new Promise((resolve) => {
    task.resume = resolve
  })
}

export async function downloadRemoteDirectory(
  tabId: string,
  remotePath: string,
  name: string,
  localDirectoryPath: string,
  task: Pick<SftpDownloadProgressEvent, 'taskId'>,
  onProgress?: (event: SftpDownloadProgressEvent) => void
): Promise<boolean> {
  const rootName = createSafeRelativePath('', basename(name))
  const localRootPath = join(localDirectoryPath, rootName)
  const entries: RemoteDownloadEntry[] = [{
    remotePath: normalizeRemotePath(remotePath), relativePath: '', type: 'directory', size: 0
  }]
  const runtimeTask: DirectoryDownloadRuntimeTask = { paused: false, canceled: false }

  await collectRemoteDownloadEntries(tabId, remotePath, '', entries)
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0)
  let transferredBytes = 0
  let completedBytes = 0
  let currentSpeedBytesPerSecond = 0
  let lastSpeedAt = Date.now()
  let lastSpeedBytes = 0

  const emitProgress = (status: SftpDownloadProgressEvent['status'], error?: string): void => {
    const now = Date.now()
    if (status === 'progress') {
      const elapsedSeconds = Math.max((now - lastSpeedAt) / 1000, 0.001)
      currentSpeedBytesPerSecond = Math.max((transferredBytes - lastSpeedBytes) / elapsedSeconds, 0)
      lastSpeedAt = now
      lastSpeedBytes = transferredBytes
    }
    onProgress?.({
      taskId: task.taskId, tabId, name, path: normalizeRemotePath(remotePath), status,
      transferredBytes, totalBytes, speedBytesPerSecond: status === 'started' ? 0 : currentSpeedBytesPerSecond,
      filePath: localRootPath, error
    })
  }

  activeDirectoryDownloadTasks.set(task.taskId, runtimeTask)
  emitProgress('started')

  try {
    for (const entry of entries) {
      if (runtimeTask.canceled) break

      const localPath = entry.relativePath ? join(localRootPath, ...entry.relativePath.split('/')) : localRootPath
      if (entry.type === 'directory') {
        await mkdir(localPath, { recursive: true })
        continue
      }

      await mkdir(join(localPath, '..'), { recursive: true })
      let completed = false
      while (!completed && !runtimeTask.canceled) {
        const childTaskId = `${task.taskId}:${entry.relativePath}`
        runtimeTask.currentTaskId = childTaskId
        const downloaded = await downloadRemoteFile(
          tabId, entry.remotePath, localPath, { taskId: childTaskId, name }, entry.size,
          (event) => {
            transferredBytes = completedBytes + event.transferredBytes
            emitProgress(event.status === 'completed' ? 'progress' : event.status, event.error)
          }
        )
        runtimeTask.currentTaskId = undefined

        if (downloaded) {
          completedBytes += entry.size
          transferredBytes = completedBytes
          completed = true
        } else if (!runtimeTask.canceled) {
          // 子文件被暂停时，若用户已在状态收敛前点击继续，直接重试并从临时文件续传。
          if (runtimeTask.paused) {
            emitProgress('paused')
            await waitForDirectoryDownloadResume(runtimeTask)
          }
          if (!runtimeTask.canceled) emitProgress('progress')
        }
      }
    }

    if (runtimeTask.canceled) {
      emitProgress('canceled')
      return false
    }

    transferredBytes = totalBytes
    emitProgress('completed')
    writeAppLog({ scope: 'main.sftp', message: '远程文件夹下载完成', data: { tabId, path: remotePath, localPath: localRootPath, size: totalBytes } })
    return true
  } catch (error) {
    emitProgress('error', error instanceof Error ? error.message : String(error))
    return false
  } finally {
    activeDirectoryDownloadTasks.delete(task.taskId)
  }
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
  const tempLocalPath = getTransferTempPath(localPath)
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
  emitProgress('started')

  try {
    let localSize = await getLocalFileSize(tempLocalPath)

    if (total > 0 && localSize > total) {
      await rm(tempLocalPath, { force: true }).catch(() => undefined)
      localSize = 0
    }

    // 本地已有半成品时从对应偏移继续读取，避免暂停后再次从 0 覆盖下载。
    const resumeOffset = total > 0 ? Math.min(localSize, total) : localSize
    transferredBytes = resumeOffset
    lastSpeedBytes = resumeOffset

    await downloadClient.connect({
      ...createServerConnectOptions(server),
      readyTimeout: 15000,
      keepaliveInterval: getSshKeepaliveIntervalMs()
    })

    if (resumeOffset > 0) {
      const rawSftp = getRawSftpClient(downloadClient)
      const remoteHandle = await openRemoteReadHandle(rawSftp, normalizedPath)
      const localFile = await openLocalFile(tempLocalPath, 'r+')
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
      await downloadClient.fastGet(normalizedPath, tempLocalPath, {
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
      await replaceLocalFile(tempLocalPath, localPath)
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
        await rm(tempLocalPath, { force: true })
      } catch (error) {
        writeAppLog({
          scope: 'main.sftp',
          level: 'warn',
          message: '下载中断后清理本地文件失败',
          data: { taskId: task.taskId, localPath: tempLocalPath, error: error instanceof Error ? error.message : String(error) }
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

