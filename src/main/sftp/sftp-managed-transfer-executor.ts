import type SftpClient from 'ssh2-sftp-client'

import {
  lstat,
  mkdir,
  open as openLocalFile,
  rm,
  statfs
} from 'node:fs/promises'
import { dirname, join as joinLocalPath } from 'node:path'
import { tmpdir } from 'node:os'

import { appConfig } from '../../shared/config.js'
import { compareFileFingerprints, createLocalFileFingerprintReader } from './file-fingerprint.js'
import {
  acquireSftpConnection,
  type SftpConnectionLease
} from './sftp-connection-pool.js'
import {
  closeRemoteHandle,
  createRemoteFileFingerprintReader,
  getLocalFileSize,
  getRawSftpClient,
  lstatRemotePath,
  getRemoteUploadResumeOffset,
  getTransferTempPath,
  normalizeRemotePath,
  openRemoteReadHandle,
  readRemoteChunk,
  replaceLocalFile,
  uploadLocalFileToRemote
} from './sftp-transfer-common.js'

export interface ManagedTransferControl {
  paused: boolean
  canceled: boolean
}

interface ManagedTransferBase {
  nodeId: string
  size: number
  control: ManagedTransferControl
  onProgress: (transferredBytes: number, speedBytesPerSecond: number) => void
}

export interface ManagedUploadFileInput extends ManagedTransferBase {
  kind: 'upload'
  serverId: string
  localPath: string
  remotePath: string
  expectedModifyTime?: number
}

export interface ManagedDownloadFileInput extends ManagedTransferBase {
  kind: 'download'
  serverId: string
  remotePath: string
  localPath: string
  expectedModifyTime?: number
}

export interface ManagedRelayFileInput extends ManagedTransferBase {
  kind: 'relay'
  sourceServerId: string
  targetServerId: string
  sourcePath: string
  targetPath: string
  localPath: string
  expectedModifyTime?: number
}

export type ManagedFileTransferInput =
  | ManagedUploadFileInput
  | ManagedDownloadFileInput
  | ManagedRelayFileInput

export type ManagedTransferResult = 'completed' | 'paused' | 'canceled'

const localFingerprintReader = createLocalFileFingerprintReader()
const RESERVED_DISK_BYTES = 1024 * 1024 * 1024
let reservedRelayBytes = 0

async function assertRemoteSourceUnchanged(
  client: SftpClient,
  path: string,
  size: number,
  expectedModifyTime?: number
): Promise<void> {
  const sourceStat = await lstatRemotePath(client, path)
  if (sourceStat.isSymbolicLink) throw new Error('暂不支持符号链接')
  if (!sourceStat.isFile) throw new Error('传输源文件不存在或类型已变化')
  if (sourceStat.size !== size) throw new Error('传输源文件大小已发生变化')
  if (
    typeof expectedModifyTime === 'number'
    && Math.trunc(sourceStat.modifyTime) !== Math.trunc(expectedModifyTime)
  ) {
    throw new Error('传输源文件修改时间已发生变化')
  }
}

function createProgressReporter(
  onProgress: ManagedTransferBase['onProgress'],
  initialBytes = 0
): (transferredBytes: number) => void {
  let lastAt = Date.now()
  let lastBytes = initialBytes

  return (transferredBytes) => {
    const now = Date.now()
    const elapsedSeconds = Math.max((now - lastAt) / 1000, 0.001)
    const speed = Math.max((transferredBytes - lastBytes) / elapsedSeconds, 0)

    lastAt = now
    lastBytes = transferredBytes
    onProgress(transferredBytes, speed)
  }
}

async function downloadRemoteFileToPath(
  client: SftpClient,
  remotePath: string,
  localPath: string,
  totalBytes: number,
  control: ManagedTransferControl,
  onProgress: (transferredBytes: number) => void
): Promise<void> {
  let localSize = await getLocalFileSize(localPath)

  if (localSize > totalBytes) {
    await rm(localPath, { force: true }).catch(() => undefined)
    localSize = 0
  }

  const resumeOffset = Math.min(localSize, totalBytes)
  onProgress(resumeOffset)
  if (totalBytes === 0) {
    const emptyFile = await openLocalFile(localPath, 'w')
    await emptyFile.close()
    return
  }
  if (resumeOffset >= totalBytes || control.paused || control.canceled) return

  const rawSftp = getRawSftpClient(client)
  const remoteHandle = await openRemoteReadHandle(rawSftp, remotePath)
  const localFile = await openLocalFile(localPath, resumeOffset > 0 ? 'r+' : 'w')
  let nextReadPosition = resumeOffset
  let contiguousTransferredBytes = resumeOffset
  const completedChunks = new Map<number, number>()

  const recordCompletedChunk = (position: number, length: number): void => {
    completedChunks.set(position, length)

    while (true) {
      const chunkLength = completedChunks.get(contiguousTransferredBytes)
      if (!chunkLength) break
      completedChunks.delete(contiguousTransferredBytes)
      contiguousTransferredBytes += chunkLength
    }

    onProgress(contiguousTransferredBytes)
  }

  try {
    const readRemainingChunks = async (): Promise<void> => {
      while (!control.paused && !control.canceled && nextReadPosition < totalBytes) {
        const position = nextReadPosition
        const length = Math.min(
          appConfig.sftp.download.fastGetChunkSizeBytes,
          totalBytes - position
        )
        nextReadPosition += length
        const chunk = await readRemoteChunk(rawSftp, remoteHandle, length, position)

        if (chunk.length === 0 || control.paused || control.canceled) return

        await localFile.write(chunk, 0, chunk.length, position)
        recordCompletedChunk(position, chunk.length)
      }
    }

    await Promise.all(
      Array.from(
        { length: appConfig.sftp.download.fastGetConcurrency },
        () => readRemainingChunks()
      )
    )
  } finally {
    await closeRemoteHandle(rawSftp, remoteHandle).catch(() => undefined)
    await localFile.close().catch(() => undefined)
  }
}

async function runUpload(input: ManagedUploadFileInput): Promise<ManagedTransferResult> {
  const sourceStat = await lstat(input.localPath)
  if (sourceStat.isSymbolicLink()) throw new Error('暂不支持符号链接')
  if (!sourceStat.isFile()) throw new Error('上传源文件不存在或类型已变化')
  if (sourceStat.size !== input.size) throw new Error('上传源文件大小已发生变化')
  if (
    typeof input.expectedModifyTime === 'number'
    && Math.trunc(sourceStat.mtimeMs) !== Math.trunc(input.expectedModifyTime)
  ) {
    throw new Error('上传源文件修改时间已发生变化')
  }

  const lease = await acquireSftpConnection(input.serverId, input.nodeId)
  let reusable = true

  try {
    const client = lease.client
    await client.mkdir(dirname(input.remotePath).replace(/\\/g, '/'), true)
    const comparison = await compareFileFingerprints(
      { reader: localFingerprintReader, path: input.localPath },
      { reader: createRemoteFileFingerprintReader(client), path: input.remotePath },
      input.size
    )

    if (comparison.matched) return 'completed'

    const tempRemotePath = getTransferTempPath(input.remotePath)
    const resumeOffset = await getRemoteUploadResumeOffset(
      client,
      tempRemotePath,
      input.size,
      true
    )
    const reportProgress = createProgressReporter(input.onProgress, resumeOffset)

    await uploadLocalFileToRemote(
      input.control,
      client,
      input.localPath,
      input.remotePath,
      input.size,
      resumeOffset,
      reportProgress
    )

    if (input.control.canceled) {
      await client.delete(tempRemotePath).catch(() => undefined)
      return 'canceled'
    }
    if (input.control.paused) return 'paused'
    return 'completed'
  } catch (error) {
    reusable = false
    throw error
  } finally {
    await lease.release(reusable)
  }
}

async function runDownload(input: ManagedDownloadFileInput): Promise<ManagedTransferResult> {
  const lease = await acquireSftpConnection(input.serverId, input.nodeId)
  const tempLocalPath = getTransferTempPath(input.localPath)
  let reusable = true

  try {
    await assertRemoteSourceUnchanged(
      lease.client,
      input.remotePath,
      input.size,
      input.expectedModifyTime
    )
    await mkdir(dirname(input.localPath), { recursive: true })
    const reportProgress = createProgressReporter(input.onProgress)
    await downloadRemoteFileToPath(
      lease.client,
      normalizeRemotePath(input.remotePath),
      tempLocalPath,
      input.size,
      input.control,
      reportProgress
    )

    if (input.control.canceled) {
      await rm(tempLocalPath, { force: true }).catch(() => undefined)
      return 'canceled'
    }
    if (input.control.paused) return 'paused'

    await assertRemoteSourceUnchanged(
      lease.client,
      input.remotePath,
      input.size,
      input.expectedModifyTime
    )

    await replaceLocalFile(tempLocalPath, input.localPath)
    return 'completed'
  } catch (error) {
    reusable = false
    throw error
  } finally {
    await lease.release(reusable)
  }
}

async function reserveRelayDiskSpace(localPath: string, size: number): Promise<() => void> {
  const disk = await statfs(dirname(localPath))
  const freeBytes = Number(disk.bavail) * Number(disk.bsize)

  if (freeBytes - reservedRelayBytes - size < RESERVED_DISK_BYTES) {
    throw new Error('本地中转磁盘空间不足，至少需要保留 1GB 可用空间')
  }

  reservedRelayBytes += size
  return () => {
    reservedRelayBytes = Math.max(reservedRelayBytes - size, 0)
  }
}

async function runRelay(input: ManagedRelayFileInput): Promise<ManagedTransferResult> {
  await mkdir(dirname(input.localPath), { recursive: true })
  const releaseReservation = await reserveRelayDiskSpace(input.localPath, input.size)
  const sourceLease = await acquireSftpConnection(input.sourceServerId, `${input.nodeId}-source`)
  let targetLease: SftpConnectionLease | undefined
  let sourceReusable = true
  let targetReusable = true

  try {
    targetLease = await acquireSftpConnection(input.targetServerId, `${input.nodeId}-target`)
    await assertRemoteSourceUnchanged(
      sourceLease.client,
      input.sourcePath,
      input.size,
      input.expectedModifyTime
    )
    const comparison = await compareFileFingerprints(
      { reader: createRemoteFileFingerprintReader(sourceLease.client), path: input.sourcePath },
      { reader: createRemoteFileFingerprintReader(targetLease.client), path: input.targetPath },
      input.size
    )

    if (comparison.matched) {
      await rm(input.localPath, { force: true }).catch(() => undefined)
      return 'completed'
    }

    const localBytes = await getLocalFileSize(input.localPath)
    if (localBytes < input.size) {
      const reportDownload = createProgressReporter(input.onProgress, localBytes)
      await downloadRemoteFileToPath(
        sourceLease.client,
        input.sourcePath,
        input.localPath,
        input.size,
        input.control,
        reportDownload
      )
    }

    if (input.control.canceled) {
      await rm(input.localPath, { force: true }).catch(() => undefined)
      await targetLease.client.delete(getTransferTempPath(input.targetPath)).catch(() => undefined)
      return 'canceled'
    }
    if (input.control.paused) return 'paused'

    await assertRemoteSourceUnchanged(
      sourceLease.client,
      input.sourcePath,
      input.size,
      input.expectedModifyTime
    )

    await targetLease.client.mkdir(dirname(input.targetPath).replace(/\\/g, '/'), true)
    const tempRemotePath = getTransferTempPath(input.targetPath)
    const uploadOffset = await getRemoteUploadResumeOffset(
      targetLease.client,
      tempRemotePath,
      input.size,
      true
    )
    const reportUpload = createProgressReporter(
      input.onProgress,
      input.size + uploadOffset
    )

    await uploadLocalFileToRemote(
      input.control,
      targetLease.client,
      input.localPath,
      input.targetPath,
      input.size,
      uploadOffset,
      bytes => reportUpload(input.size + bytes)
    )

    if (input.control.canceled) {
      await rm(input.localPath, { force: true }).catch(() => undefined)
      await targetLease.client.delete(tempRemotePath).catch(() => undefined)
      return 'canceled'
    }
    if (input.control.paused) return 'paused'

    await rm(input.localPath, { force: true }).catch(() => undefined)
    return 'completed'
  } catch (error) {
    sourceReusable = false
    targetReusable = false
    throw error
  } finally {
    releaseReservation()
    await sourceLease.release(sourceReusable)
    await targetLease?.release(targetReusable)
  }
}

export async function executeManagedFileTransfer(
  input: ManagedFileTransferInput
): Promise<ManagedTransferResult> {
  if (input.kind === 'upload') return runUpload(input)
  if (input.kind === 'download') return runDownload(input)
  return runRelay(input)
}

export function createRelayTempPath(taskId: string, relativePath: string): string {
  return joinLocalPath(
    getRelayTempRoot(),
    taskId,
    ...relativePath.split('/').filter(Boolean)
  )
}

export function getRelayTempRoot(): string {
  return joinLocalPath(tmpdir(), 'orbitssh-transfer-tasks')
}
