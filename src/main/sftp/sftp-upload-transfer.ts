import SftpClient from 'ssh2-sftp-client'

import { readdir, stat as statLocalFile } from 'node:fs/promises'
import { basename, dirname, join as joinLocalPath, relative } from 'node:path'

import { writeAppLog } from '../logger.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'
import { getSshConnectionOptions } from '../ssh/connection-options.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { appConfig } from '../../shared/config.js'
import type {
  RemoteFileNode,
  SftpUploadProgressEvent,
  SftpUploadResult
} from '../../shared/sftp.js'
import { compareFileFingerprints, createLocalFileFingerprintReader } from './file-fingerprint.js'
import { getSftpSession } from './sftp-session-registry.js'
import {
  createRemoteFileFingerprintReader,
  enqueueTransferTask,
  getRemoteUploadResumeOffset,
  getTransferTempPath,
  joinRemotePath,
  normalizeRemotePath,
  uploadLocalFileToRemote
} from './sftp-transfer-common.js'

export interface UploadEntry {
  localPath: string
  remotePath: string
  relativePath: string
  type: RemoteFileNode['type']
  size: number
}

interface UploadScanState {
  entryCount: number
  totalBytes: number
}

export interface UploadPlan {
  name: string
  normalizedLocalPaths: string[]
  normalizedRemoteDirectoryPath: string
  entries: UploadEntry[]
  totalBytes: number
}

interface UploadRuntimeTask {
  client: SftpClient
  tabId: string
  name: string
  localPaths: string[]
  remoteDirectoryPath: string
  entries: UploadEntry[]
  paused: boolean
  canceled: boolean
  completedRemotePaths: Set<string>
  currentRemotePath?: string
  transferredBytes: number
  totalBytes: number
  skippedFileCount: number
  skippedBytes: number
  emitProgress: (status: SftpUploadProgressEvent['status'], error?: string) => void
}

interface PausedUploadTask {
  tabId: string
  name: string
  localPaths: string[]
  remoteDirectoryPath: string
  entries: UploadEntry[]
  completedRemotePaths: string[]
  currentRemotePath?: string
  transferredBytes: number
  totalBytes: number
  skippedFileCount: number
  skippedBytes: number
}

const activeUploadTasks = new Map<string, UploadRuntimeTask>()
const pausedUploadTasks = new Map<string, PausedUploadTask>()
const localFileFingerprintReader = createLocalFileFingerprintReader()

function getUploadDisplayName(localPaths: string[]): string {
  return localPaths.length === 1 ? basename(localPaths[0]) : `${localPaths.length} 个项目`
}

function createPausedUploadTask(task: UploadRuntimeTask): PausedUploadTask {
  return {
    tabId: task.tabId,
    name: task.name,
    localPaths: task.localPaths,
    remoteDirectoryPath: task.remoteDirectoryPath,
    entries: task.entries,
    completedRemotePaths: [...task.completedRemotePaths],
    currentRemotePath: task.currentRemotePath,
    transferredBytes: task.transferredBytes,
    totalBytes: task.totalBytes,
    skippedFileCount: task.skippedFileCount,
    skippedBytes: task.skippedBytes
  }
}

function stopUploadConnection(taskId: string, task: UploadRuntimeTask): void {
  void task.client.end().catch((error) => {
    writeAppLog({
      scope: 'main.sftp',
      level: 'warn',
      message: '取消上传时关闭连接失败',
      data: { taskId, error: error instanceof Error ? error.message : String(error) }
    })
  })
}

async function collectUploadEntriesForPath(
  localPath: string,
  remoteDirectoryPath: string,
  rootLocalPath: string,
  depth: number,
  scanState: UploadScanState
): Promise<UploadEntry[]> {
  if (depth > appConfig.sftp.upload.maxScanDepth) {
    throw new Error(`上传目录层级超过 ${appConfig.sftp.upload.maxScanDepth} 层，请拆分后再上传`)
  }

  const localStat = await statLocalFile(localPath)
  const relativePath = localPath === rootLocalPath
    ? basename(localPath)
    : relative(dirname(rootLocalPath), localPath)
  const remotePath = joinRemotePath(remoteDirectoryPath, relativePath)

  if (localStat.isFile()) {
    scanState.entryCount += 1
    scanState.totalBytes += localStat.size

    if (scanState.entryCount > appConfig.sftp.upload.maxScanEntries) {
      throw new Error(`上传文件数量超过 ${appConfig.sftp.upload.maxScanEntries} 个，请拆分后再上传`)
    }
    if (scanState.totalBytes > appConfig.sftp.upload.maxScanTotalBytes) {
      throw new Error('上传总大小超过限制，请拆分后再上传')
    }

    return [{
      localPath,
      remotePath,
      relativePath: relativePath.replace(/\\/g, '/'),
      type: 'file',
      size: localStat.size
    }]
  }

  if (!localStat.isDirectory()) {
    return []
  }

  scanState.entryCount += 1
  if (scanState.entryCount > appConfig.sftp.upload.maxScanEntries) {
    throw new Error(`上传项目数量超过 ${appConfig.sftp.upload.maxScanEntries} 个，请拆分后再上传`)
  }

  const queue: UploadEntry[] = [{
    localPath,
    remotePath,
    relativePath: relativePath.replace(/\\/g, '/'),
    type: 'directory',
    size: 0
  }]
  const entries = await readdir(localPath, { withFileTypes: true })

  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })

  for (const entry of entries) {
    queue.push(...await collectUploadEntriesForPath(
      joinLocalPath(localPath, entry.name),
      remoteDirectoryPath,
      rootLocalPath,
      depth + 1,
      scanState
    ))
  }

  return queue
}

async function collectUploadEntries(localPaths: string[], remoteDirectoryPath: string): Promise<UploadEntry[]> {
  const scanState: UploadScanState = { entryCount: 0, totalBytes: 0 }
  const entries: UploadEntry[] = []

  for (const localPath of localPaths) {
    entries.push(...await collectUploadEntriesForPath(
      localPath,
      remoteDirectoryPath,
      localPath,
      0,
      scanState
    ))
  }

  return entries
}

export async function createUploadPlan(remoteDirectoryPath: string, localPaths: string[]): Promise<UploadPlan> {
  const normalizedRemoteDirectoryPath = normalizeRemotePath(remoteDirectoryPath)
  const normalizedLocalPaths = localPaths.filter(Boolean)
  const entries = await collectUploadEntries(normalizedLocalPaths, normalizedRemoteDirectoryPath)

  return {
    name: getUploadDisplayName(normalizedLocalPaths),
    normalizedLocalPaths,
    normalizedRemoteDirectoryPath,
    entries,
    totalBytes: entries.reduce((total, entry) => total + entry.size, 0)
  }
}

function getCompletedUploadBytes(entries: UploadEntry[], completedRemotePaths: Set<string>): number {
  return entries.reduce(
    (total, entry) => completedRemotePaths.has(entry.remotePath) ? total + entry.size : total,
    0
  )
}

function getCompletedUploadEntryCount(entries: UploadEntry[], completedRemotePaths: Set<string>): number {
  return entries.filter((entry) => completedRemotePaths.has(entry.remotePath)).length
}

export async function uploadLocalPathsToRemoteDirectory(
  tabId: string,
  remoteDirectoryPath: string,
  localPaths: string[],
  task: Pick<SftpUploadProgressEvent, 'taskId'>,
  onProgress?: (event: SftpUploadProgressEvent) => void,
  uploadPlan?: UploadPlan,
  resumeState?: Pick<
    PausedUploadTask,
    | 'completedRemotePaths'
    | 'currentRemotePath'
    | 'transferredBytes'
    | 'totalBytes'
    | 'skippedFileCount'
    | 'skippedBytes'
  >
): Promise<SftpUploadResult> {
  const session = getSftpSession(tabId)
  const plan = uploadPlan ?? await createUploadPlan(remoteDirectoryPath, localPaths)
  const normalizedRemoteDirectoryPath = plan.normalizedRemoteDirectoryPath
  const normalizedLocalPaths = plan.normalizedLocalPaths
  const server = getServerAuthConfig(session.serverId)
  const uploadClient = new SftpClient(`upload-${task.taskId}`)
  const { name, entries, totalBytes } = plan
  const completedRemotePaths = new Set(resumeState?.completedRemotePaths ?? [])
  let transferredBytes = Math.min(resumeState?.transferredBytes ?? 0, totalBytes)
  let currentUploadEntry = entries.find((entry) => entry.remotePath === resumeState?.currentRemotePath)
  let lastProgressAt = 0
  let lastSpeedAt = Date.now()
  let lastSpeedBytes = transferredBytes
  let currentSpeedBytesPerSecond = 0
  let wasCanceled = false
  let wasPaused = false
  let skippedFileCount = resumeState?.skippedFileCount ?? 0
  let skippedBytes = resumeState?.skippedBytes ?? 0

  if (normalizedLocalPaths.length === 0) {
    return { uploaded: false, remoteDirectoryPath: normalizedRemoteDirectoryPath, uploadedCount: 0 }
  }

  const emitProgress = (status: SftpUploadProgressEvent['status'], error?: string): void => {
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
      serverId: session.serverId,
      name,
      path: normalizedRemoteDirectoryPath,
      status,
      transferredBytes,
      totalBytes,
      speedBytesPerSecond: status === 'started' ? 0 : currentSpeedBytesPerSecond,
      localPaths: normalizedLocalPaths,
      remoteDirectoryPath: normalizedRemoteDirectoryPath,
      uploadEntryCount: entries.length,
      uploadedEntryCount: getCompletedUploadEntryCount(entries, completedRemotePaths),
      currentUploadPath: currentUploadEntry?.relativePath,
      currentUploadType: currentUploadEntry?.type,
      error
    })
  }
  const uploadTask: UploadRuntimeTask = {
    client: uploadClient,
    tabId,
    name,
    localPaths: normalizedLocalPaths,
    remoteDirectoryPath: normalizedRemoteDirectoryPath,
    entries,
    paused: false,
    canceled: false,
    completedRemotePaths,
    currentRemotePath: resumeState?.currentRemotePath,
    transferredBytes,
    totalBytes,
    skippedFileCount,
    skippedBytes,
    emitProgress
  }

  activeUploadTasks.set(task.taskId, uploadTask)
  emitProgress('started')

  try {
    await uploadClient.connect({
      ...createServerConnectOptions(server),
      ...getSshConnectionOptions()
    })
    await uploadClient.mkdir(normalizedRemoteDirectoryPath, true)

    for (const entry of entries) {
      if (uploadTask.paused || uploadTask.canceled) break
      if (uploadTask.completedRemotePaths.has(entry.remotePath)) continue

      currentUploadEntry = entry
      uploadTask.currentRemotePath = entry.remotePath
      emitProgress('progress')

      if (entry.type === 'directory') {
        await uploadClient.mkdir(entry.remotePath, true)
        uploadTask.completedRemotePaths.add(entry.remotePath)
        uploadTask.currentRemotePath = undefined
        currentUploadEntry = undefined
        emitProgress('progress')
        continue
      }

      const localStat = await statLocalFile(entry.localPath)
      if (!localStat.isFile()) {
        throw new Error(`上传源文件不存在或不可读取：${entry.localPath}`)
      }

      await uploadClient.mkdir(dirname(entry.remotePath).replace(/\\/g, '/'), true)
      const tempRemotePath = getTransferTempPath(entry.remotePath)
      const comparison = await compareFileFingerprints(
        { reader: localFileFingerprintReader, path: entry.localPath },
        { reader: createRemoteFileFingerprintReader(uploadClient), path: entry.remotePath },
        entry.size
      )

      if (uploadTask.paused || uploadTask.canceled) break
      if (comparison.reason === 'read-error') {
        writeAppLog({
          scope: 'main.sftp',
          level: 'warn',
          message: '上传文件指纹校验失败，继续正常传输',
          data: {
            taskId: task.taskId,
            localPath: entry.localPath,
            remotePath: entry.remotePath,
            error: comparison.error
          }
        })
      }

      if (comparison.matched) {
        // 目标已一致时清理旧半成品，并复用已完成集合推进逻辑进度。
        await uploadClient.delete(tempRemotePath).catch(() => undefined)
        uploadTask.completedRemotePaths.add(entry.remotePath)
        uploadTask.currentRemotePath = undefined
        currentUploadEntry = undefined
        skippedFileCount += 1
        skippedBytes += entry.size
        uploadTask.skippedFileCount = skippedFileCount
        uploadTask.skippedBytes = skippedBytes
        transferredBytes = getCompletedUploadBytes(entries, uploadTask.completedRemotePaths)
        uploadTask.transferredBytes = transferredBytes
        // 跳过字节属于逻辑完成量，不计入实时传输速度。
        lastSpeedAt = Date.now()
        lastSpeedBytes = transferredBytes
        currentSpeedBytesPerSecond = 0
        emitProgress('progress')
        continue
      }

      const shouldResumeEntry = entry.remotePath === resumeState?.currentRemotePath
      const entryBaseTransferred = getCompletedUploadBytes(entries, uploadTask.completedRemotePaths)
      const savedCurrentFileBytes = Math.max(
        (resumeState?.transferredBytes ?? entryBaseTransferred) - entryBaseTransferred,
        0
      )
      const safeUploadResumeOffset = shouldResumeEntry
        ? Math.min(savedCurrentFileBytes, entry.size)
        : undefined
      const uploadResumeOffset = await getRemoteUploadResumeOffset(
        uploadClient,
        tempRemotePath,
        entry.size,
        shouldResumeEntry,
        safeUploadResumeOffset
      )

      transferredBytes = entryBaseTransferred + uploadResumeOffset
      uploadTask.transferredBytes = transferredBytes
      emitProgress('progress')

      await uploadLocalFileToRemote(
        uploadTask,
        uploadClient,
        entry.localPath,
        entry.remotePath,
        entry.size,
        uploadResumeOffset,
        (totalTransferred) => {
          const now = Date.now()
          transferredBytes = entryBaseTransferred + totalTransferred
          uploadTask.transferredBytes = transferredBytes

          if (!uploadTask.paused && !uploadTask.canceled && now - lastProgressAt >= appConfig.sftp.download.progressIntervalMs) {
            lastProgressAt = now
            emitProgress('progress')
          }
        }
      )

      if (uploadTask.paused || uploadTask.canceled) break

      uploadTask.completedRemotePaths.add(entry.remotePath)
      uploadTask.currentRemotePath = undefined
      currentUploadEntry = undefined
      transferredBytes = entryBaseTransferred + entry.size
      uploadTask.transferredBytes = transferredBytes
      emitProgress('progress')
    }

    if (uploadTask.canceled) wasCanceled = true
    else if (uploadTask.paused) wasPaused = true
    else {
      transferredBytes = totalBytes
      uploadTask.transferredBytes = transferredBytes
      emitProgress('completed')
    }
  } catch (error) {
    if (uploadTask.canceled) wasCanceled = true
    else if (uploadTask.paused) wasPaused = true
    else {
      emitProgress('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  } finally {
    const isCurrentTask = activeUploadTasks.get(task.taskId) === uploadTask

    if (isCurrentTask) activeUploadTasks.delete(task.taskId)
    if (isCurrentTask && wasCanceled && uploadTask.currentRemotePath) {
      await uploadClient.delete(getTransferTempPath(uploadTask.currentRemotePath)).catch(() => undefined)
    }
    await uploadClient.end().catch(() => undefined)

    if (isCurrentTask && wasPaused) {
      pausedUploadTasks.set(task.taskId, {
        tabId,
        name,
        localPaths: normalizedLocalPaths,
        remoteDirectoryPath: normalizedRemoteDirectoryPath,
        entries,
        completedRemotePaths: [...uploadTask.completedRemotePaths],
        currentRemotePath: uploadTask.currentRemotePath,
        transferredBytes,
        totalBytes,
        skippedFileCount: uploadTask.skippedFileCount,
        skippedBytes: uploadTask.skippedBytes
      })
      emitProgress('paused')
    } else if (isCurrentTask && wasCanceled) {
      pausedUploadTasks.delete(task.taskId)
      emitProgress('canceled')
    } else if (isCurrentTask) {
      pausedUploadTasks.delete(task.taskId)
    }
  }

  if (wasPaused || wasCanceled) {
    return {
      uploaded: false,
      taskId: task.taskId,
      remoteDirectoryPath: normalizedRemoteDirectoryPath,
      uploadedCount: transferredBytes > 0 ? entries.length : 0
    }
  }

  writeAppLog({
    scope: 'main.sftp',
    message: '本地文件上传完成',
    data: {
      tabId,
      remoteDirectoryPath: normalizedRemoteDirectoryPath,
      selectedCount: normalizedLocalPaths.length,
      uploadedCount: entries.length,
      skippedFileCount,
      skippedBytes
    }
  })

  return {
    uploaded: entries.length > 0,
    taskId: task.taskId,
    remoteDirectoryPath: normalizedRemoteDirectoryPath,
    uploadedCount: entries.length
  }
}

function emitPausedUploadState(
  taskId: string,
  pausedTask: PausedUploadTask,
  status: SftpUploadProgressEvent['status'],
  onProgress?: (event: SftpUploadProgressEvent) => void,
  error?: string
): void {
  const currentEntry = pausedTask.entries.find((entry) => entry.remotePath === pausedTask.currentRemotePath)

  onProgress?.({
    taskId,
    tabId: pausedTask.tabId,
    name: pausedTask.name,
    path: pausedTask.remoteDirectoryPath,
    status,
    transferredBytes: pausedTask.transferredBytes,
    totalBytes: pausedTask.totalBytes,
    speedBytesPerSecond: 0,
    localPaths: pausedTask.localPaths,
    remoteDirectoryPath: pausedTask.remoteDirectoryPath,
    uploadEntryCount: pausedTask.entries.length,
    uploadedEntryCount: getCompletedUploadEntryCount(pausedTask.entries, new Set(pausedTask.completedRemotePaths)),
    currentUploadPath: currentEntry?.relativePath,
    currentUploadType: currentEntry?.type,
    error
  })
}

export async function controlRemoteUploadTask(
  taskId: string,
  action: 'pause' | 'resume' | 'cancel',
  onProgress?: (event: SftpUploadProgressEvent) => void
): Promise<boolean> {
  const task = activeUploadTasks.get(taskId)

  if (task) {
    if (action === 'pause') {
      task.paused = true
      // 等待当前分块自然收口并释放队列槽，避免立即恢复时被旧任务阻塞。
      pausedUploadTasks.set(taskId, createPausedUploadTask(task))
      return true
    }
    if (action === 'cancel') {
      task.canceled = true
      pausedUploadTasks.delete(taskId)
      task.emitProgress('canceled')
      stopUploadConnection(taskId, task)
      return true
    }
    return false
  }

  const pausedTask = pausedUploadTasks.get(taskId)
  if (!pausedTask) return false

  if (action === 'cancel') {
    pausedUploadTasks.delete(taskId)
    emitPausedUploadState(taskId, pausedTask, 'canceled', onProgress)
    return true
  }
  if (action !== 'resume') return false

  pausedUploadTasks.delete(taskId)
  emitPausedUploadState(taskId, pausedTask, 'queued', onProgress)
  void enqueueTransferTask(taskId, () => uploadLocalPathsToRemoteDirectory(
    pausedTask.tabId,
    pausedTask.remoteDirectoryPath,
    pausedTask.localPaths,
    { taskId },
    onProgress,
    {
      name: pausedTask.name,
      normalizedLocalPaths: pausedTask.localPaths,
      normalizedRemoteDirectoryPath: pausedTask.remoteDirectoryPath,
      entries: pausedTask.entries,
      totalBytes: pausedTask.totalBytes
    },
    {
      completedRemotePaths: pausedTask.completedRemotePaths,
      currentRemotePath: pausedTask.currentRemotePath,
      transferredBytes: pausedTask.transferredBytes,
      totalBytes: pausedTask.totalBytes,
      skippedFileCount: pausedTask.skippedFileCount,
      skippedBytes: pausedTask.skippedBytes
    }
  )).catch((error) => {
    emitPausedUploadState(
      taskId,
      pausedTask,
      'error',
      onProgress,
      error instanceof Error ? error.message : String(error)
    )
  })

  return true
}
