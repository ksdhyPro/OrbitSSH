import SftpClient from 'ssh2-sftp-client'
import type { Client as SshClient } from 'ssh2'

import { mkdir, mkdtemp, open as openLocalFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join as joinLocalPath, posix as posixPath } from 'node:path'

import { writeAppLog } from '../logger.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { appConfig } from '../../shared/config.js'
import type {
  RemoteFileNode,
  SftpRemoteTransferProgressEvent,
  SftpRemoteTransferResult,
  SftpRemoteTransferSource
} from '../../shared/sftp.js'
import type { ServerAuthConfig } from '../../shared/server.js'
import { compareFileFingerprints } from './file-fingerprint.js'
import {
  closeRemoteHandle,
  createRemoteFileFingerprintReader,
  createSftpClient,
  createSshClient,
  enqueueTransferTask,
  execSshCommand,
  getLocalFileSize,
  getRawSftpClient,
  getRemoteUploadResumeOffset,
  getTransferTempPath,
  joinRemotePath,
  normalizeRemotePath,
  openRemoteReadHandle,
  readRemoteChunk,
  uploadLocalFileToRemote
} from './sftp-transfer-common.js'

interface RemoteTransferEntry {
  sourcePath: string
  targetPath: string
  type: RemoteFileNode['type']
  size: number
}

interface RemoteTransferRuntimeTask {
  sourceServerId: string
  targetServerId: string
  sources: SftpRemoteTransferSource[]
  targetDirectoryPath: string
  sourceClient?: SftpClient
  targetClient?: SftpClient
  sshClient?: SshClient
  tempDirectoryPath?: string
  paused: boolean
  canceled: boolean
  completedSourcePaths: Set<string>
  transferredBytes: number
  totalBytes: number
  skippedFileCount: number
  skippedBytes: number
  phase: SftpRemoteTransferProgressEvent['phase']
  emitProgress: (status: SftpRemoteTransferProgressEvent['status'], error?: string) => void
}

interface PausedRemoteTransferTask {
  sourceServerId: string
  targetServerId: string
  sources: SftpRemoteTransferSource[]
  targetDirectoryPath: string
  completedSourcePaths: string[]
  tempDirectoryPath?: string
  transferredBytes: number
  totalBytes: number
  skippedFileCount: number
  skippedBytes: number
  phase: SftpRemoteTransferProgressEvent['phase']
}

const activeRemoteTransferTasks = new Map<string, RemoteTransferRuntimeTask>()
const pausedRemoteTransferTasks = new Map<string, PausedRemoteTransferTask>()

function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function getServerSshTarget(server: ServerAuthConfig): string {
  return `${server.username}@${server.host}`
}

function getRemoteTransferDisplayName(sources: SftpRemoteTransferSource[]): string {
  return sources.length === 1 ? sources[0].name : `${sources.length} 个项目`
}

function stopRemoteTransferConnections(taskId: string, task: RemoteTransferRuntimeTask): void {
  task.sshClient?.end()
  // 关闭连接可能需要等待底层分块退出，因此异步处理，避免控制按钮卡住。
  void task.sourceClient?.end().catch((error) => {
    writeAppLog({
      scope: 'main.sftp',
      level: 'warn',
      message: '停止服务器间传输源连接失败',
      data: { taskId, error: error instanceof Error ? error.message : String(error) }
    })
  })
  void task.targetClient?.end().catch((error) => {
    writeAppLog({
      scope: 'main.sftp',
      level: 'warn',
      message: '停止服务器间传输目标连接失败',
      data: { taskId, error: error instanceof Error ? error.message : String(error) }
    })
  })
}

function createPausedRemoteTransferTask(task: RemoteTransferRuntimeTask): PausedRemoteTransferTask {
  return {
    sourceServerId: task.sourceServerId,
    targetServerId: task.targetServerId,
    sources: task.sources,
    targetDirectoryPath: task.targetDirectoryPath,
    completedSourcePaths: [...task.completedSourcePaths],
    tempDirectoryPath: task.tempDirectoryPath,
    transferredBytes: task.transferredBytes,
    totalBytes: task.totalBytes,
    skippedFileCount: task.skippedFileCount,
    skippedBytes: task.skippedBytes,
    phase: task.phase
  }
}

async function cleanupRemoteTransferTempDirectory(
  taskId: string,
  tempDirectoryPath?: string
): Promise<void> {
  if (!tempDirectoryPath) return

  await rm(tempDirectoryPath, { recursive: true, force: true }).catch((error) => {
    writeAppLog({
      scope: 'main.sftp',
      level: 'warn',
      message: '服务器间传输临时目录清理失败',
      data: {
        taskId,
        tempDirectoryPath,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  })
}

async function collectRemoteTransferEntries(
  client: SftpClient,
  source: SftpRemoteTransferSource,
  targetDirectoryPath: string,
  rootSourcePath = source.path
): Promise<RemoteTransferEntry[]> {
  const normalizedSourcePath = normalizeRemotePath(source.path)
  const normalizedTargetDirectoryPath = normalizeRemotePath(targetDirectoryPath)

  if (source.type === 'file') {
    const stat = await client.stat(normalizedSourcePath)
    const relativePath = normalizedSourcePath === rootSourcePath
      ? source.name
      : posixPath.relative(posixPath.dirname(rootSourcePath), normalizedSourcePath)

    return [
      {
        sourcePath: normalizedSourcePath,
        targetPath: joinRemotePath(normalizedTargetDirectoryPath, relativePath),
        type: 'file',
        size: stat.size ?? source.size ?? 0
      }
    ]
  }

  const items = await client.list(normalizedSourcePath)
  const targetDirectory = joinRemotePath(
    normalizedTargetDirectoryPath,
    normalizedSourcePath === rootSourcePath
      ? source.name
      : posixPath.relative(posixPath.dirname(rootSourcePath), normalizedSourcePath)
  )

  if (items.length === 0) {
    return [
      {
        sourcePath: normalizedSourcePath,
        targetPath: targetDirectory,
        type: 'directory',
        size: 0
      }
    ]
  }

  const entries = await Promise.all(
    items.map((item) =>
      collectRemoteTransferEntries(
        client,
        {
          path: joinRemotePath(normalizedSourcePath, item.name),
          name: item.name,
          type: item.type === 'd' ? 'directory' : 'file',
          size: item.size
        },
        normalizedTargetDirectoryPath,
        rootSourcePath
      )
    )
  )

  return entries.flat()
}

async function collectAllRemoteTransferEntries(
  client: SftpClient,
  sources: SftpRemoteTransferSource[],
  targetDirectoryPath: string
): Promise<RemoteTransferEntry[]> {
  const entries = await Promise.all(
    sources.map((source) => collectRemoteTransferEntries(client, source, targetDirectoryPath))
  )

  return entries.flat()
}

async function tryDirectRemoteTransfer(
  task: RemoteTransferRuntimeTask,
  taskId: string,
  sourceServer: ServerAuthConfig,
  targetServer: ServerAuthConfig
): Promise<boolean> {
  const sshClient = await createSshClient(sourceServer)
  task.sshClient = sshClient

  try {
    const target = getServerSshTarget(targetServer)
    const sshBaseOptions = [
      '-o BatchMode=yes',
      '-o ConnectTimeout=8',
      '-o StrictHostKeyChecking=no',
      '-o UserKnownHostsFile=/dev/null',
      '-p',
      String(targetServer.port)
    ].join(' ')
    const probeCommand = `ssh ${sshBaseOptions} ${quoteShellValue(target)} ${quoteShellValue('pwd')}`

    await execSshCommand(sshClient, probeCommand)

    if (task.paused || task.canceled) {
      return false
    }

    const sourceArgs = task.sources.map((source) => quoteShellValue(normalizeRemotePath(source.path))).join(' ')
    const targetArg = `${target}:${normalizeRemotePath(task.targetDirectoryPath).replace(/'/g, `'\\''`)}`
    const scpCommand = [
      'scp',
      '-r',
      '-P',
      String(targetServer.port),
      '-o BatchMode=yes',
      '-o StrictHostKeyChecking=no',
      '-o UserKnownHostsFile=/dev/null',
      '--',
      sourceArgs,
      quoteShellValue(targetArg)
    ].join(' ')

    writeAppLog({
      scope: 'main.sftp',
      message: '服务器间直连传输开始',
      data: { taskId, sourceServerId: task.sourceServerId, targetServerId: task.targetServerId }
    })

    task.phase = 'direct'
    task.emitProgress('progress')
    await execSshCommand(sshClient, scpCommand)
    task.transferredBytes = task.totalBytes
    task.emitProgress('progress')
    return true
  } finally {
    task.sshClient = undefined
    sshClient.end()
  }
}

function getRelativeRemotePath(rootPath: string, childPath: string): string {
  const normalizedRoot = normalizeRemotePath(rootPath).replace(/\/$/, '')
  const normalizedChild = normalizeRemotePath(childPath)
  const prefix = `${normalizedRoot}/`

  if (normalizedChild.startsWith(prefix)) {
    return normalizedChild.slice(prefix.length)
  }

  return posixPath.basename(normalizedChild)
}

async function downloadRemoteTransferEntryToLocal(
  task: RemoteTransferRuntimeTask,
  client: SftpClient,
  entry: RemoteTransferEntry,
  localPath: string,
  onChunk: (transferredBytes: number) => void
): Promise<void> {
  let localSize = await getLocalFileSize(localPath)

  if (localSize > entry.size) {
    await rm(localPath, { force: true }).catch(() => undefined)
    localSize = 0
  }

  const resumeOffset = Math.min(localSize, entry.size)

  if (entry.size === 0) {
    const emptyFile = await openLocalFile(localPath, 'w')

    await emptyFile.close()
    onChunk(0)
    return
  }

  if (resumeOffset > 0) {
    // 复用暂停前写入的本地半成品，进度先回到真实续传偏移。
    onChunk(resumeOffset)
  }

  if (resumeOffset >= entry.size) {
    return
  }

  const rawSftp = getRawSftpClient(client)
  const remoteHandle = await openRemoteReadHandle(rawSftp, entry.sourcePath)
  const localFile = await openLocalFile(localPath, resumeOffset > 0 ? 'r+' : 'w')
  let nextReadPosition = resumeOffset
  let transferredBytes = resumeOffset

  try {
    const readRemainingChunks = async (): Promise<void> => {
      while (!task.paused && !task.canceled && nextReadPosition < entry.size) {
        const readPosition = nextReadPosition
        const readLength = Math.min(appConfig.sftp.download.fastGetChunkSizeBytes, entry.size - readPosition)
        nextReadPosition += readLength
        const chunk = await readRemoteChunk(rawSftp, remoteHandle, readLength, readPosition)

        if (chunk.length === 0 || task.paused || task.canceled) {
          return
        }

        // 并发分块按远程偏移写入本地临时文件，暂停时最多多完成当前分块。
        await localFile.write(chunk, 0, chunk.length, readPosition)
        transferredBytes += chunk.length
        onChunk(transferredBytes)
      }
    }

    await Promise.all(
      Array.from({ length: appConfig.sftp.download.fastGetConcurrency }, () => readRemainingChunks())
    )
  } finally {
    await closeRemoteHandle(rawSftp, remoteHandle).catch(() => undefined)
    await localFile.close().catch(() => undefined)
  }
}

async function prepareRemoteTransferFingerprints(
  task: RemoteTransferRuntimeTask,
  taskId: string,
  entries: RemoteTransferEntry[],
  sourceServer: ServerAuthConfig,
  targetServer: ServerAuthConfig
): Promise<{ skippedFileCount: number; skippedBytes: number }> {
  const sourceClient = await createSftpClient(`remote-fingerprint-source-${taskId}`, sourceServer)
  const targetClient = await createSftpClient(`remote-fingerprint-target-${taskId}`, targetServer)
  const sourceReader = createRemoteFileFingerprintReader(sourceClient)
  const targetReader = createRemoteFileFingerprintReader(targetClient)
  let skippedFileCount = 0
  let skippedBytes = 0

  task.sourceClient = sourceClient
  task.targetClient = targetClient
  task.phase = 'preparing'

  const getCompletedFileBytes = (): number =>
    entries.reduce(
      (total, entry) =>
        entry.type === 'file' && task.completedSourcePaths.has(entry.sourcePath)
          ? total + entry.size
          : total,
      0
    )

  try {
    for (const entry of entries) {
      if (task.paused || task.canceled || task.completedSourcePaths.has(entry.sourcePath)) {
        continue
      }

      if (entry.type === 'directory') {
        // 目录条目代表空目录，提前创建后即可按完成处理。
        await targetClient.mkdir(entry.targetPath, true)
        task.completedSourcePaths.add(entry.sourcePath)
        continue
      }

      const comparison = await compareFileFingerprints(
        { reader: sourceReader, path: entry.sourcePath },
        { reader: targetReader, path: entry.targetPath },
        entry.size
      )

      if (task.paused || task.canceled) {
        break
      }

      if (comparison.reason === 'read-error') {
        writeAppLog({
          scope: 'main.sftp',
          level: 'warn',
          message: '服务器互传文件指纹校验失败，继续正常传输',
          data: {
            taskId,
            sourcePath: entry.sourcePath,
            targetPath: entry.targetPath,
            error: comparison.error
          }
        })
      }

      if (!comparison.matched) {
        continue
      }

      await targetClient.delete(getTransferTempPath(entry.targetPath)).catch(() => undefined)
      task.completedSourcePaths.add(entry.sourcePath)
      skippedFileCount += 1
      skippedBytes += entry.size
      task.transferredBytes = getCompletedFileBytes()
      task.emitProgress('progress')
    }

    return { skippedFileCount, skippedBytes }
  } finally {
    await sourceClient.end().catch(() => undefined)
    await targetClient.end().catch(() => undefined)
    task.sourceClient = undefined
    task.targetClient = undefined
  }
}

async function runLocalRelayRemoteTransfer(
  task: RemoteTransferRuntimeTask,
  taskId: string,
  entries: RemoteTransferEntry[],
  sourceServer: ServerAuthConfig,
  targetServer: ServerAuthConfig
): Promise<void> {
  const sourceClient = await createSftpClient(`remote-transfer-source-${taskId}`, sourceServer)
  const targetClient = await createSftpClient(`remote-transfer-target-${taskId}`, targetServer)
  const tempDirectoryPath = task.tempDirectoryPath ?? (await mkdtemp(joinLocalPath(tmpdir(), `orbitssh-transfer-${taskId}-`)))
  let lastProgressAt = 0
  let lastSpeedAt = Date.now()
  let lastSpeedBytes = task.transferredBytes
  let currentSpeedBytesPerSecond = 0

  task.sourceClient = sourceClient
  task.targetClient = targetClient
  task.tempDirectoryPath = tempDirectoryPath

  const getCompletedFileBytes = (): number =>
    entries.reduce(
      (total, entry) =>
        entry.type === 'file' && task.completedSourcePaths.has(entry.sourcePath)
          ? total + entry.size
          : total,
      0
    )
  const getLogicalTransferBytes = (
    completedFileBytes: number,
    entrySize: number,
    phase: 'download' | 'upload',
    phaseTransferredBytes: number
  ): number => {
    // 本地中转展示为两段进度：下载到本地占前 50%，上传到目标占后 50%。
    const completedBytes = completedFileBytes
    const entryHalfBytes = entrySize / 2

    if (phase === 'download') {
      return completedBytes + Math.min(phaseTransferredBytes, entrySize) / 2
    }

    return completedBytes + entryHalfBytes + Math.min(phaseTransferredBytes, entrySize) / 2
  }
  const emitProgress = (): void => {
    const now = Date.now()
    const elapsedSeconds = Math.max((now - lastSpeedAt) / 1000, 0.001)
    currentSpeedBytesPerSecond = Math.max((task.transferredBytes - lastSpeedBytes) / elapsedSeconds, 0)
    lastSpeedAt = now
    lastSpeedBytes = task.transferredBytes
    task.emitProgress('progress')
  }
  const resumeUploadTransferBytes = task.phase === 'upload' ? task.transferredBytes : undefined
  let shouldResumeUploadEntry = task.phase === 'upload'

  try {
    await targetClient.mkdir(normalizeRemotePath(task.targetDirectoryPath), true)

    for (const entry of entries) {
      if (task.paused || task.canceled) {
        break
      }

      if (task.completedSourcePaths.has(entry.sourcePath)) {
        continue
      }

      if (entry.type === 'directory') {
        await targetClient.mkdir(entry.targetPath, true)
        task.completedSourcePaths.add(entry.sourcePath)
        continue
      }

      const relativePath = getRelativeRemotePath(task.targetDirectoryPath, entry.targetPath)
      const localPath = joinLocalPath(tempDirectoryPath, ...relativePath.split('/').filter(Boolean))
      const completedFileBytes = getCompletedFileBytes()
      const existingLocalBytes = await getLocalFileSize(localPath)
      const localResumeOffset = existingLocalBytes > entry.size ? 0 : existingLocalBytes

      await mkdir(dirname(localPath), { recursive: true })
      await targetClient.mkdir(posixPath.dirname(entry.targetPath), true)
      task.phase = 'download'
      // 恢复中转下载时先按本地半成品大小展示进度，避免任务面板短暂回跳到当前文件 0%。
      task.transferredBytes = getLogicalTransferBytes(completedFileBytes, entry.size, 'download', localResumeOffset)
      emitProgress()
      await downloadRemoteTransferEntryToLocal(task, sourceClient, entry, localPath, (totalTransferred) => {
        const now = Date.now()
        task.transferredBytes = getLogicalTransferBytes(completedFileBytes, entry.size, 'download', totalTransferred)

        if (!task.paused && !task.canceled && now - lastProgressAt >= appConfig.sftp.download.progressIntervalMs) {
          lastProgressAt = now
          emitProgress()
        }
      })

      if (task.paused || task.canceled) {
        break
      }

      const canResumeUpload = shouldResumeUploadEntry
      shouldResumeUploadEntry = false
      const safeUploadResumeOffset = canResumeUpload
        && typeof resumeUploadTransferBytes === 'number'
        ? Math.min(
            Math.max(resumeUploadTransferBytes - completedFileBytes - entry.size / 2, 0) * 2,
            entry.size
          )
        : undefined
      const uploadResumeOffset = await getRemoteUploadResumeOffset(
        targetClient,
        entry.targetPath,
        entry.size,
        canResumeUpload,
        safeUploadResumeOffset
      )
      task.phase = 'upload'
      task.transferredBytes = getLogicalTransferBytes(completedFileBytes, entry.size, 'upload', uploadResumeOffset)
      emitProgress()
      await uploadLocalFileToRemote(
        task,
        targetClient,
        localPath,
        entry.targetPath,
        entry.size,
        uploadResumeOffset,
        (totalTransferred) => {
          const now = Date.now()
          task.transferredBytes = getLogicalTransferBytes(completedFileBytes, entry.size, 'upload', totalTransferred)

          if (!task.paused && !task.canceled && now - lastProgressAt >= appConfig.sftp.download.progressIntervalMs) {
            lastProgressAt = now
            emitProgress()
          }
        }
      )

      if (task.paused || task.canceled) {
        break
      }

      const targetStat = await targetClient.stat(entry.targetPath)

      if ((targetStat.size ?? 0) !== entry.size) {
        throw new Error(`目标文件大小校验失败：${entry.targetPath}`)
      }

      task.completedSourcePaths.add(entry.sourcePath)
      task.transferredBytes = getCompletedFileBytes()
      emitProgress()
      await rm(localPath, { force: true }).catch(() => undefined)
    }
  } finally {
    await sourceClient.end().catch(() => undefined)
    await targetClient.end().catch(() => undefined)
    task.sourceClient = undefined
    task.targetClient = undefined
  }
}

export async function transferRemoteSourcesBetweenServers(

  input: {
    taskId: string
    sourceServerId: string
    targetServerId: string
    sources: SftpRemoteTransferSource[]
    targetDirectoryPath: string
  },
  onProgress?: (event: SftpRemoteTransferProgressEvent) => void,
  resumeState?: Pick<
    PausedRemoteTransferTask,
    | 'completedSourcePaths'
    | 'tempDirectoryPath'
    | 'transferredBytes'
    | 'totalBytes'
    | 'phase'
    | 'skippedFileCount'
    | 'skippedBytes'
  >
): Promise<SftpRemoteTransferResult> {
  const normalizedSources = input.sources.filter((source) => source.path && source.name)
  const normalizedTargetDirectoryPath = normalizeRemotePath(input.targetDirectoryPath)

  if (normalizedSources.length === 0) {
    return { transferred: false, taskId: input.taskId, transferredCount: 0 }
  }

  const sourceServer = getServerAuthConfig(input.sourceServerId)
  const targetServer = getServerAuthConfig(input.targetServerId)
  const name = getRemoteTransferDisplayName(normalizedSources)
  let totalBytes = resumeState?.totalBytes ?? normalizedSources.reduce((total, source) => total + (source.size ?? 0), 0)
  let transferredBytes = resumeState?.transferredBytes ?? 0
  let lastSpeedAt = Date.now()
  let lastSpeedBytes = transferredBytes
  let currentSpeedBytesPerSecond = 0
  let entries: RemoteTransferEntry[] = []
  let skippedFileCount = resumeState?.skippedFileCount ?? 0
  let skippedBytes = resumeState?.skippedBytes ?? 0
  let wasPaused = false
  let wasCanceled = false
  const task: RemoteTransferRuntimeTask = {
    sourceServerId: input.sourceServerId,
    targetServerId: input.targetServerId,
    sources: normalizedSources,
    targetDirectoryPath: normalizedTargetDirectoryPath,
    tempDirectoryPath: resumeState?.tempDirectoryPath,
    paused: false,
    canceled: false,
    completedSourcePaths: new Set(resumeState?.completedSourcePaths ?? []),
    transferredBytes,
    totalBytes,
    skippedFileCount,
    skippedBytes,
    phase: resumeState?.phase ?? 'preparing',
    emitProgress: (status, error) => {
      const now = Date.now()

      if (status === 'progress') {
        const elapsedSeconds = Math.max((now - lastSpeedAt) / 1000, 0.001)
        currentSpeedBytesPerSecond = Math.max((task.transferredBytes - lastSpeedBytes) / elapsedSeconds, 0)
        lastSpeedAt = now
        lastSpeedBytes = task.transferredBytes
      }

      onProgress?.({
        taskId: input.taskId,
        sourceServerId: input.sourceServerId,
        targetServerId: input.targetServerId,
        name,
        path: normalizedSources[0].path,
        targetDirectoryPath: normalizedTargetDirectoryPath,
        phase: task.phase,
        status,
        transferredBytes: task.transferredBytes,
        totalBytes: task.totalBytes,
        speedBytesPerSecond:
          task.phase === 'preparing' || ['started', 'paused', 'canceled', 'error'].includes(status)
            ? 0
            : currentSpeedBytesPerSecond,
        sources: normalizedSources,
        error
      })
    }
  }

  activeRemoteTransferTasks.set(input.taskId, task)
  task.emitProgress('started')

  try {
    const collectClient = await createSftpClient(`remote-transfer-collect-${input.taskId}`, sourceServer)
    task.sourceClient = collectClient

    try {
      if (!task.paused && !task.canceled) {
        entries = await collectAllRemoteTransferEntries(collectClient, normalizedSources, normalizedTargetDirectoryPath)
        totalBytes = entries.reduce((total, entry) => total + entry.size, 0)
        task.totalBytes = totalBytes
        task.phase = 'preparing'
        task.emitProgress('progress')
      }
    } finally {
      if (task.sourceClient === collectClient) {
        task.sourceClient = undefined
      }
      await collectClient.end().catch(() => undefined)
    }

    if (!task.paused && !task.canceled && entries.length > 0) {
      const fingerprintSummary = await prepareRemoteTransferFingerprints(
        task,
        input.taskId,
        entries,
        sourceServer,
        targetServer
      )

      skippedFileCount += fingerprintSummary.skippedFileCount
      skippedBytes += fingerprintSummary.skippedBytes
      task.skippedFileCount = skippedFileCount
      task.skippedBytes = skippedBytes
    }

    if (task.paused || task.canceled) {
      // 目录收集阶段已收到暂停/取消请求，避免继续进入直连或本地中转。
    } else if (!resumeState && skippedFileCount === 0 && entries.length > 0) {
      try {
        const transferredDirectly = await tryDirectRemoteTransfer(task, input.taskId, sourceServer, targetServer)

        if (transferredDirectly) {
          task.transferredBytes = task.totalBytes
          task.emitProgress('completed')
          return { transferred: true, taskId: input.taskId, transferredCount: entries.length }
        }
      } catch (error) {
        if (task.paused || task.canceled) {
          throw error
        }

        writeAppLog({
          scope: 'main.sftp',
          level: 'warn',
          message: '服务器间直连传输不可用，切换本地中转',
          data: {
            taskId: input.taskId,
            sourceServerId: input.sourceServerId,
            targetServerId: input.targetServerId,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    if (
      !task.paused
      && !task.canceled
      && entries.some((entry) => !task.completedSourcePaths.has(entry.sourcePath))
    ) {
      await runLocalRelayRemoteTransfer(task, input.taskId, entries, sourceServer, targetServer)
    }

    if (task.canceled) {
      wasCanceled = true
    } else if (task.paused) {
      wasPaused = true
    } else {
      task.transferredBytes = task.totalBytes
      task.phase = 'upload'
      task.emitProgress('completed')
    }
  } catch (error) {
    if (task.canceled) {
      wasCanceled = true
    } else if (task.paused) {
      wasPaused = true
    } else {
      task.emitProgress('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  } finally {
    const isCurrentTask = activeRemoteTransferTasks.get(input.taskId) === task

    if (isCurrentTask) {
      activeRemoteTransferTasks.delete(input.taskId)
    }
    task.sshClient?.end()
    await task.sourceClient?.end().catch(() => undefined)
    await task.targetClient?.end().catch(() => undefined)

    if (!wasPaused) {
      await cleanupRemoteTransferTempDirectory(input.taskId, task.tempDirectoryPath)
    }

    if (isCurrentTask && wasPaused) {
      pausedRemoteTransferTasks.set(input.taskId, createPausedRemoteTransferTask(task))
      task.emitProgress('paused')
    } else if (isCurrentTask && wasCanceled) {
      pausedRemoteTransferTasks.delete(input.taskId)
      task.emitProgress('canceled')
    } else if (isCurrentTask) {
      pausedRemoteTransferTasks.delete(input.taskId)
    }
  }

  if (wasPaused || wasCanceled) {
    return {
      transferred: false,
      taskId: input.taskId,
      transferredCount: task.completedSourcePaths.size
    }
  }

  writeAppLog({
    scope: 'main.sftp',
    message: '服务器间传输完成',
    data: {
      taskId: input.taskId,
      sourceServerId: input.sourceServerId,
      targetServerId: input.targetServerId,
      sourceCount: normalizedSources.length,
      transferredCount: entries.length,
      skippedFileCount,
      skippedBytes
    }
  })

  return { transferred: entries.length > 0, taskId: input.taskId, transferredCount: entries.length }
}

export async function controlRemoteTransferTask(
  taskId: string,
  action: 'pause' | 'resume' | 'cancel',
  onProgress?: (event: SftpRemoteTransferProgressEvent) => void
): Promise<boolean> {
  const resumePausedTask = (
    pausedTask: PausedRemoteTransferTask
  ): boolean => {
    pausedRemoteTransferTasks.delete(taskId)
    onProgress?.({
      taskId,
      sourceServerId: pausedTask.sourceServerId,
      targetServerId: pausedTask.targetServerId,
      name: getRemoteTransferDisplayName(pausedTask.sources),
      path: pausedTask.sources[0]?.path ?? '',
      targetDirectoryPath: pausedTask.targetDirectoryPath,
      phase: pausedTask.phase,
      status: 'queued',
      transferredBytes: pausedTask.transferredBytes,
      totalBytes: pausedTask.totalBytes,
      speedBytesPerSecond: 0,
      sources: pausedTask.sources
    })
    void enqueueTransferTask(taskId, () => transferRemoteSourcesBetweenServers(
      {
        taskId,
        sourceServerId: pausedTask.sourceServerId,
        targetServerId: pausedTask.targetServerId,
        sources: pausedTask.sources,
        targetDirectoryPath: pausedTask.targetDirectoryPath
      },
      onProgress,
      {
        completedSourcePaths: pausedTask.completedSourcePaths,
        tempDirectoryPath: pausedTask.tempDirectoryPath,
        transferredBytes: pausedTask.transferredBytes,
        totalBytes: pausedTask.totalBytes,
        phase: pausedTask.phase,
        skippedFileCount: pausedTask.skippedFileCount,
        skippedBytes: pausedTask.skippedBytes
      }
    )).catch((error) => {
      onProgress?.({
        taskId,
        sourceServerId: pausedTask.sourceServerId,
        targetServerId: pausedTask.targetServerId,
        name: getRemoteTransferDisplayName(pausedTask.sources),
        path: pausedTask.sources[0]?.path ?? '',
        targetDirectoryPath: pausedTask.targetDirectoryPath,
        phase: pausedTask.phase,
        status: 'error',
        transferredBytes: pausedTask.transferredBytes,
        totalBytes: pausedTask.totalBytes,
        speedBytesPerSecond: 0,
        sources: pausedTask.sources,
        error: error instanceof Error ? error.message : String(error)
      })
    })

    return true
  }

  const task = activeRemoteTransferTasks.get(taskId)

  if (task) {
    if (action === 'pause') {
      task.paused = true
      pausedRemoteTransferTasks.set(taskId, createPausedRemoteTransferTask(task))
      task.emitProgress('paused')
      stopRemoteTransferConnections(taskId, task)

      return true
    }

    if (action === 'cancel') {
      task.canceled = true
      pausedRemoteTransferTasks.delete(taskId)
      stopRemoteTransferConnections(taskId, task)
      return true
    }

    if (action === 'resume' && task.paused) {
      const pausedTask = pausedRemoteTransferTasks.get(taskId)

      if (!pausedTask) {
        return false
      }

      // 参照普通下载的恢复方式：旧连接继续异步收尾，新传输直接基于暂停快照重启。
      activeRemoteTransferTasks.delete(taskId)
      stopRemoteTransferConnections(taskId, task)
      return resumePausedTask(pausedTask)
    }

    return false
  }

  const pausedTask = pausedRemoteTransferTasks.get(taskId)

  if (!pausedTask) {
    return false
  }

  if (action === 'cancel') {
    pausedRemoteTransferTasks.delete(taskId)
    await cleanupRemoteTransferTempDirectory(taskId, pausedTask.tempDirectoryPath)
    onProgress?.({
      taskId,
      sourceServerId: pausedTask.sourceServerId,
      targetServerId: pausedTask.targetServerId,
      name: getRemoteTransferDisplayName(pausedTask.sources),
      path: pausedTask.sources[0]?.path ?? '',
      targetDirectoryPath: pausedTask.targetDirectoryPath,
      phase: pausedTask.phase,
      status: 'canceled',
      transferredBytes: pausedTask.transferredBytes,
      totalBytes: pausedTask.totalBytes,
      speedBytesPerSecond: 0,
      sources: pausedTask.sources
    })
    return true
  }

  if (action !== 'resume') {
    return false
  }

  return resumePausedTask(pausedTask)
}
