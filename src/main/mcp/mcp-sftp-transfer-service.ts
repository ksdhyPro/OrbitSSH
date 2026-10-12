import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import path from 'node:path'

import type { OrbitSshMcpTransferResult } from '../../shared/mcp.js'
import { getSettings } from '../storage/settings-store.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { acquireSftpConnection } from '../sftp/sftp-connection-pool.js'
import { executeManagedFileTransfer } from '../sftp/sftp-managed-transfer-executor.js'
import {
  enqueueTransferTask,
  lstatRemotePath,
  normalizeRemotePath
} from '../sftp/sftp-transfer-common.js'
import { OrbitSshMcpError } from './mcp-command-service.js'

const MAX_RETAINED_FINISHED_TASKS = 100
// MCP 任务只保存轻量状态；文件内容始终由主进程在本地路径和 SFTP 连接间流式传输。
const transferTasks = new Map<string, OrbitSshMcpTransferResult>()
const activeTargetKeys = new Map<string, string>()

function assertMcpSftpAccessEnabled(): void {
  if (!getSettings().ai.allowMcpSftpAccess) {
    throw new OrbitSshMcpError(
      'MCP_SFTP_ACCESS_DISABLED',
      '请先在 OrbitSSH 客户端的“设置 → AI”中开启“允许第三方 AI 通过 MCP 使用 SFTP”'
    )
  }
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OrbitSshMcpError('INVALID_ARGUMENT', `${fieldName}不能为空`)
  }

  const normalized = value.trim()
  if (normalized.includes('\0')) {
    throw new OrbitSshMcpError('INVALID_ARGUMENT', `${fieldName}不能包含空字符`)
  }
  return normalized
}

function normalizeLocalPath(value: unknown): string {
  const localPath = normalizeRequiredString(value, 'localPath')
  if (!path.isAbsolute(localPath)) {
    throw new OrbitSshMcpError('INVALID_ARGUMENT', 'localPath 必须是本地绝对路径')
  }
  return path.normalize(localPath)
}

function normalizeMcpRemotePath(value: unknown): string {
  return normalizeRemotePath(normalizeRequiredString(value, 'remotePath'))
}

function cloneTask(task: OrbitSshMcpTransferResult): OrbitSshMcpTransferResult {
  return { ...task }
}

function pruneFinishedTasks(): void {
  const finishedTasks = [...transferTasks.values()]
    .filter(task => task.status === 'completed' || task.status === 'failed')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  const removeCount = Math.max(finishedTasks.length - MAX_RETAINED_FINISHED_TASKS, 0)
  for (const task of finishedTasks.slice(0, removeCount)) {
    transferTasks.delete(task.id)
  }
}

function createTask(
  direction: OrbitSshMcpTransferResult['direction'],
  connectionId: string,
  connectionName: string,
  localPath: string,
  remotePath: string,
  targetKey: string
): OrbitSshMcpTransferResult {
  const activeTaskId = activeTargetKeys.get(targetKey)
  if (activeTaskId) {
    throw new OrbitSshMcpError(
      'TRANSFER_CONFLICT',
      `目标路径已有进行中的传输任务：${activeTaskId}`
    )
  }

  pruneFinishedTasks()
  const task: OrbitSshMcpTransferResult = {
    id: randomUUID(),
    direction,
    status: 'queued',
    connectionId,
    connectionName,
    localPath,
    remotePath,
    transferredBytes: 0,
    totalBytes: 0,
    speedBytesPerSecond: 0,
    createdAt: new Date().toISOString()
  }
  transferTasks.set(task.id, task)
  activeTargetKeys.set(targetKey, task.id)
  return task
}

function completeTask(task: OrbitSshMcpTransferResult): void {
  task.status = 'completed'
  task.transferredBytes = task.totalBytes
  task.speedBytesPerSecond = 0
  task.completedAt = new Date().toISOString()
}

function failTask(task: OrbitSshMcpTransferResult, error: unknown): void {
  task.status = 'failed'
  task.speedBytesPerSecond = 0
  task.completedAt = new Date().toISOString()
  task.error = error instanceof Error ? error.message : String(error)
}

async function runUploadTask(task: OrbitSshMcpTransferResult): Promise<void> {
  const sourceStat = await lstat(task.localPath)
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new Error('上传源路径必须是普通文件，暂不支持符号链接')
  }

  task.totalBytes = sourceStat.size
  const result = await executeManagedFileTransfer({
    kind: 'upload',
    nodeId: task.id,
    serverId: task.connectionId,
    localPath: task.localPath,
    remotePath: task.remotePath,
    size: sourceStat.size,
    expectedModifyTime: sourceStat.mtimeMs,
    control: { paused: false, canceled: false },
    onProgress: (transferredBytes, speedBytesPerSecond) => {
      task.transferredBytes = transferredBytes
      task.speedBytesPerSecond = speedBytesPerSecond
    }
  })

  if (result !== 'completed') throw new Error('SFTP 上传未完成')
}

async function runDownloadTask(task: OrbitSshMcpTransferResult): Promise<void> {
  const lease = await acquireSftpConnection(task.connectionId, `${task.id}-metadata`)
  let sourceStat: Awaited<ReturnType<typeof lstatRemotePath>>

  try {
    sourceStat = await lstatRemotePath(lease.client, task.remotePath)
  } finally {
    await lease.release()
  }

  if (sourceStat.isSymbolicLink || !sourceStat.isFile) {
    throw new Error('下载源路径必须是普通文件，暂不支持符号链接')
  }

  task.totalBytes = sourceStat.size
  const result = await executeManagedFileTransfer({
    kind: 'download',
    nodeId: task.id,
    serverId: task.connectionId,
    localPath: task.localPath,
    remotePath: task.remotePath,
    size: sourceStat.size,
    expectedModifyTime: sourceStat.modifyTime,
    control: { paused: false, canceled: false },
    onProgress: (transferredBytes, speedBytesPerSecond) => {
      task.transferredBytes = transferredBytes
      task.speedBytesPerSecond = speedBytesPerSecond
    }
  })

  if (result !== 'completed') throw new Error('SFTP 下载未完成')
}

function startTask(
  task: OrbitSshMcpTransferResult,
  targetKey: string,
  run: () => Promise<void>
): void {
  queueMicrotask(() => {
    // 复用现有 SFTP 并发队列，避免 MCP 调用绕过应用配置的传输并发上限。
    void enqueueTransferTask(task.id, async () => {
      task.status = 'transferring'
      task.startedAt = new Date().toISOString()
      // 执行器会复用目标旁的 .download 临时文件，并在完整后覆盖正式文件。
      await run()
    })
      .then(() => completeTask(task))
      .catch(error => failTask(task, error))
      .finally(() => {
        if (activeTargetKeys.get(targetKey) === task.id) activeTargetKeys.delete(targetKey)
      })
  })
}

export function startMcpSftpUpload(
  params: Record<string, unknown>
): OrbitSshMcpTransferResult {
  assertMcpSftpAccessEnabled()
  const connectionId = normalizeRequiredString(params.connectionId, 'connectionId')
  const localPath = normalizeLocalPath(params.localPath)
  const remotePath = normalizeMcpRemotePath(params.remotePath)
  const server = getServerAuthConfig(connectionId)
  const targetKey = `upload\0${connectionId}\0${remotePath}`
  const task = createTask('upload', connectionId, server.name, localPath, remotePath, targetKey)

  startTask(task, targetKey, () => runUploadTask(task))
  return cloneTask(task)
}

export function startMcpSftpDownload(
  params: Record<string, unknown>
): OrbitSshMcpTransferResult {
  assertMcpSftpAccessEnabled()
  const connectionId = normalizeRequiredString(params.connectionId, 'connectionId')
  const localPath = normalizeLocalPath(params.localPath)
  const remotePath = normalizeMcpRemotePath(params.remotePath)
  const server = getServerAuthConfig(connectionId)
  const targetKey = `download\0${localPath}`
  const task = createTask('download', connectionId, server.name, localPath, remotePath, targetKey)

  startTask(task, targetKey, () => runDownloadTask(task))
  return cloneTask(task)
}

export function getMcpSftpTransferStatus(
  params: Record<string, unknown>
): OrbitSshMcpTransferResult {
  assertMcpSftpAccessEnabled()
  const id = normalizeRequiredString(params.id, 'id')
  const task = transferTasks.get(id)

  if (!task) {
    throw new OrbitSshMcpError('TRANSFER_NOT_FOUND', 'SFTP 传输任务不存在或已过期')
  }

  return cloneTask(task)
}
