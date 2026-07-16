import SftpClient from 'ssh2-sftp-client'
import { Client as SshClient } from 'ssh2'

import { open as openLocalFile, rename, rm, stat } from 'node:fs/promises'

import { writeAppLog } from '../logger.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'
import { getSshKeepaliveIntervalMs } from '../ssh/connection-options.js'
import { appConfig } from '../../shared/config.js'
import type { ServerAuthConfig } from '../../shared/server.js'
import type { FileFingerprintReader } from './file-fingerprint.js'

export interface RawSftpClient {
  open: (path: string, flags: string, callback: (error: Error | undefined, handle: Buffer) => void) => void
  read: (
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | undefined, bytesRead: number) => void
  ) => void
  write: (
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error?: Error) => void
  ) => void
  close: (handle: Buffer, callback: (error?: Error) => void) => void
}

export interface PausableTransferTask {
  paused: boolean
  canceled: boolean
}

interface TransferQueueItem<T> {
  taskId: string
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const transferQueue: TransferQueueItem<unknown>[] = []
let activeTransferCount = 0

function getMaxConcurrentTransferTasks(): number {
  return Math.max(1, appConfig.sftp.transfer.maxConcurrentTasks)
}

function runNextQueuedTransfer(): void {
  if (activeTransferCount >= getMaxConcurrentTransferTasks()) {
    return
  }

  const item = transferQueue.shift()

  if (!item) {
    return
  }

  activeTransferCount += 1
  writeAppLog({
    scope: 'main.sftp',
    message: '传输任务开始执行',
    data: {
      taskId: item.taskId,
      activeTransferCount,
      queuedTransferCount: transferQueue.length,
      maxConcurrentTransferTasks: getMaxConcurrentTransferTasks()
    }
  })

  void item.run()
    .then(item.resolve)
    .catch(item.reject)
    .finally(() => {
      activeTransferCount = Math.max(activeTransferCount - 1, 0)
      runNextQueuedTransfer()
    })
}

export function enqueueTransferTask<T>(taskId: string, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    transferQueue.push({
      taskId,
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject
    })

    writeAppLog({
      scope: 'main.sftp',
      message: '传输任务进入队列',
      data: {
        taskId,
        activeTransferCount,
        queuedTransferCount: transferQueue.length,
        maxConcurrentTransferTasks: getMaxConcurrentTransferTasks()
      }
    })
    runNextQueuedTransfer()
  })
}

export async function getLocalFileSize(path: string): Promise<number> {
  try {
    const metadata = await stat(path)

    return metadata.isFile() ? metadata.size : 0
  } catch {
    return 0
  }
}

export function getRawSftpClient(client: SftpClient): RawSftpClient {
  const rawSftp = (client as unknown as { sftp?: RawSftpClient }).sftp

  if (!rawSftp) {
    throw new Error('SFTP 连接尚未初始化')
  }

  return rawSftp
}

export function openRemoteReadHandle(sftp: RawSftpClient, path: string): Promise<Buffer> {
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

export function openRemoteWriteHandle(
  sftp: RawSftpClient,
  path: string,
  flags: 'w' | 'r+'
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, flags, (error, handle) => {
      if (error) {
        reject(error)
        return
      }

      resolve(handle)
    })
  })
}

export function closeRemoteHandle(sftp: RawSftpClient, handle: Buffer): Promise<void> {
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

export function writeRemoteChunk(
  sftp: RawSftpClient,
  handle: Buffer,
  buffer: Buffer,
  position: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.write(handle, buffer, 0, buffer.length, position, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

export function readRemoteChunk(
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

export function normalizeRemotePath(path: string): string {
  const trimmedPath = path.trim()

  return trimmedPath ? trimmedPath.replace(/\/+/g, '/') : '.'
}

export function joinRemotePath(parentPath: string, childName: string): string {
  const normalizedParentPath = normalizeRemotePath(parentPath)
  const pathPrefix = normalizedParentPath.endsWith('/') ? normalizedParentPath : `${normalizedParentPath}/`

  return `${pathPrefix}${childName.replace(/\\/g, '/')}`.replace(/\/+/g, '/')
}

export function getTransferTempPath(path: string): string {
  return `${path}.download`
}

export async function replaceLocalFile(sourcePath: string, targetPath: string): Promise<void> {
  await rm(targetPath, { force: true }).catch(() => undefined)
  await rename(sourcePath, targetPath)
}

export async function replaceRemoteFile(
  client: SftpClient,
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await client.delete(targetPath).catch(() => undefined)
  await client.rename(sourcePath, targetPath)
}

export function createSftpClient(name: string, server: ServerAuthConfig): Promise<SftpClient> {
  const client = new SftpClient(name)

  return client
    .connect({
      ...createServerConnectOptions(server),
      readyTimeout: 15000,
      keepaliveInterval: getSshKeepaliveIntervalMs()
    })
    .then(() => client)
}

export function createSshClient(server: ServerAuthConfig): Promise<SshClient> {
  const client = new SshClient()

  return new Promise((resolve, reject) => {
    client
      .once('ready', () => resolve(client))
      .once('error', reject)
      .connect({
        ...createServerConnectOptions(server),
        readyTimeout: 15000,
        keepaliveInterval: getSshKeepaliveIntervalMs()
      })
  })
}

export function execSshCommand(
  client: SshClient,
  command: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }

      const stdout: Buffer[] = []
      const stderr: Buffer[] = []

      stream.on('data', (chunk: Buffer) => stdout.push(chunk))
      stream.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      stream.on('close', (code: number) => {
        const stdoutText = Buffer.concat(stdout).toString('utf8')
        const stderrText = Buffer.concat(stderr).toString('utf8')

        if (code === 0) {
          resolve({ stdout: stdoutText, stderr: stderrText })
          return
        }

        reject(new Error(stderrText.trim() || `远端命令执行失败：${code}`))
      })
      stream.on('error', reject)
    })
  })
}

export function createRemoteFileFingerprintReader(client: SftpClient): FileFingerprintReader {
  return {
    async stat(path) {
      try {
        const metadata = await client.stat(path)

        return metadata.isFile
          ? { size: metadata.size, modifyTime: metadata.modifyTime }
          : null
      } catch {
        return null
      }
    },
    async open(path) {
      const rawSftp = getRawSftpClient(client)
      const handle = await openRemoteReadHandle(rawSftp, path)

      return {
        read: (offset, length) => readRemoteChunk(rawSftp, handle, length, offset),
        close: () => closeRemoteHandle(rawSftp, handle)
      }
    }
  }
}

export async function getRemoteUploadResumeOffset(
  client: SftpClient,
  remotePath: string,
  totalBytes: number,
  allowResume: boolean,
  safeResumeOffset?: number
): Promise<number> {
  if (!allowResume || totalBytes <= 0) {
    return 0
  }

  try {
    const remoteStat = await client.stat(remotePath)

    if (remoteStat.isDirectory) {
      throw new Error(`目标路径已存在同名目录：${remotePath}`)
    }

    if (remoteStat.size > totalBytes) {
      return 0
    }

    if (typeof safeResumeOffset === 'number') {
      return Math.min(Math.max(safeResumeOffset, 0), remoteStat.size, totalBytes)
    }

    return Math.min(remoteStat.size, totalBytes)
  } catch (error) {
    if (error instanceof Error && error.message.includes('目标路径已存在同名目录')) {
      throw error
    }

    return 0
  }
}

export async function uploadLocalFileToRemote(
  task: PausableTransferTask,
  client: SftpClient,
  localPath: string,
  remotePath: string,
  totalBytes: number,
  resumeOffset: number,
  onChunk: (transferredBytes: number) => void
): Promise<void> {
  const rawSftp = getRawSftpClient(client)
  const tempRemotePath = getTransferTempPath(remotePath)

  if (totalBytes === 0) {
    const emptyRemoteHandle = await openRemoteWriteHandle(rawSftp, tempRemotePath, 'w')

    await closeRemoteHandle(rawSftp, emptyRemoteHandle).catch(() => undefined)
    onChunk(0)
    await replaceRemoteFile(client, tempRemotePath, remotePath)
    return
  }

  if (resumeOffset > 0) {
    // 目标端已有半成品时从对应偏移继续写，避免上传阶段暂停后回到 50% 重新上传。
    onChunk(resumeOffset)
  }

  if (resumeOffset >= totalBytes) {
    await replaceRemoteFile(client, tempRemotePath, remotePath)
    return
  }

  const localFile = await openLocalFile(localPath, 'r')
  let remoteHandle: Buffer | undefined
  let nextReadPosition = resumeOffset
  let contiguousTransferredBytes = resumeOffset
  const completedChunks = new Map<number, number>()
  const recordCompletedChunk = (position: number, length: number): void => {
    const previousTransferredBytes = contiguousTransferredBytes

    completedChunks.set(position, length)

    while (true) {
      const chunkLength = completedChunks.get(contiguousTransferredBytes)

      if (!chunkLength) {
        break
      }

      completedChunks.delete(contiguousTransferredBytes)
      contiguousTransferredBytes += chunkLength
    }

    if (contiguousTransferredBytes > previousTransferredBytes) {
      onChunk(contiguousTransferredBytes)
    }
  }

  try {
    remoteHandle = await openRemoteWriteHandle(rawSftp, tempRemotePath, resumeOffset > 0 ? 'r+' : 'w')

    const uploadRemainingChunks = async (): Promise<void> => {
      while (!task.paused && !task.canceled && nextReadPosition < totalBytes) {
        const readPosition = nextReadPosition
        const readLength = Math.min(appConfig.sftp.download.fastGetChunkSizeBytes, totalBytes - readPosition)
        nextReadPosition += readLength
        const buffer = Buffer.allocUnsafe(readLength)
        const { bytesRead } = await localFile.read(buffer, 0, readLength, readPosition)

        if (bytesRead === 0 || task.paused || task.canceled) {
          return
        }

        const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)

        // 并发写入剩余分块，进度只推进到连续完成的位置，保证后续仍可安全续传。
        await writeRemoteChunk(rawSftp, remoteHandle as Buffer, chunk, readPosition)
        recordCompletedChunk(readPosition, chunk.length)
      }
    }

    await Promise.all(
      Array.from({ length: appConfig.sftp.download.fastGetConcurrency }, () => uploadRemainingChunks())
    )
  } finally {
    if (remoteHandle) {
      await closeRemoteHandle(rawSftp, remoteHandle).catch(() => undefined)
    }
    await localFile.close().catch(() => undefined)
  }

  if (!task.paused && !task.canceled) {
    await replaceRemoteFile(client, tempRemotePath, remotePath)
  }
}
