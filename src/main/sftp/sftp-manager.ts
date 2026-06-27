import SftpClient from 'ssh2-sftp-client'
import { Client as SshClient } from 'ssh2'

import { mkdir, mkdtemp, open as openLocalFile, readdir, rm, stat as statLocalFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join as joinLocalPath, posix as posixPath, relative } from 'node:path'

import { writeAppLog } from '../logger.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'
import { getIdleDisconnectMs, getSshKeepaliveIntervalMs } from '../ssh/connection-options.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { appConfig } from '../../shared/config.js'
import type {
  RemoteFileNode,
  SftpDownloadProgressEvent,
  SftpInitResult,
  SftpPreviewImageResult,
  SftpProbeTextResult,
  SftpRemoteTransferProgressEvent,
  SftpRemoteTransferResult,
  SftpRemoteTransferSource,
  SftpReadTextResult,
  SftpUploadProgressEvent,
  SftpUploadResult
} from '../../shared/sftp.js'
import type { ServerAuthConfig } from '../../shared/server.js'

interface SftpSession {
  tabId: string
  serverId: string
  client: SftpClient
  homePath: string
  lastActiveAt: number
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

interface DownloadRuntimeTask {
  client: SftpClient
  localPath: string
  paused: boolean
  canceled: boolean
  emitProgress: (status: SftpDownloadProgressEvent['status'], error?: string) => void
}

interface PausableTransferTask {
  paused: boolean
  canceled: boolean
}

interface UploadFileEntry {
  localPath: string
  remotePath: string
  size: number
}

interface UploadRuntimeTask {
  client: SftpClient
  tabId: string
  name: string
  localPaths: string[]
  remoteDirectoryPath: string
  paused: boolean
  canceled: boolean
  completedRemotePaths: Set<string>
  currentRemotePath?: string
  transferredBytes: number
  totalBytes: number
  emitProgress: (status: SftpUploadProgressEvent['status'], error?: string) => void
}

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
  phase: SftpRemoteTransferProgressEvent['phase']
}

interface PausedUploadTask {
  tabId: string
  name: string
  localPaths: string[]
  remoteDirectoryPath: string
  completedRemotePaths: string[]
  currentRemotePath?: string
  transferredBytes: number
  totalBytes: number
}

const sftpSessions = new Map<string, SftpSession>()
const { maxEditableFileSizeBytes, textProbeSampleBytes } = appConfig.sftp.textEditor
const idleDisconnectCheckIntervalMs = 30_000
const activeDownloadTasks = new Map<string, DownloadRuntimeTask>()
const activeUploadTasks = new Map<string, UploadRuntimeTask>()
const pausedUploadTasks = new Map<string, PausedUploadTask>()
const activeRemoteTransferTasks = new Map<string, RemoteTransferRuntimeTask>()
const pausedRemoteTransferTasks = new Map<string, PausedRemoteTransferTask>()
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

function stopRemoteTransferConnections(taskId: string, task: RemoteTransferRuntimeTask): void {
  task.sshClient?.end()
  // SFTP 中转下载/上传阶段关闭连接可能需要等待底层分块读写退出，这里异步执行，避免控制 IPC 卡住任务中心按钮。
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
    phase: task.phase
  }
}

// 记录普通上传暂停时的进度快照，继续时用于跳过已完成文件并续传当前文件。
function createPausedUploadTask(task: UploadRuntimeTask): PausedUploadTask {
  return {
    tabId: task.tabId,
    name: task.name,
    localPaths: task.localPaths,
    remoteDirectoryPath: task.remoteDirectoryPath,
    completedRemotePaths: [...task.completedRemotePaths],
    currentRemotePath: task.currentRemotePath,
    transferredBytes: task.transferredBytes,
    totalBytes: task.totalBytes
  }
}

function stopUploadConnection(taskId: string, task: UploadRuntimeTask, action: 'pause' | 'cancel'): void {
  // 上传暂停/取消只负责快速打断连接，不能阻塞 IPC 返回，否则任务面板会一直处于操作中。
  void task.client.end().catch((error) => {
    writeAppLog({
      scope: 'main.sftp',
      level: 'warn',
      message: action === 'pause' ? '暂停上传时关闭连接失败' : '取消上传时关闭连接失败',
      data: { taskId, error: error instanceof Error ? error.message : String(error) }
    })
  })
}

// 统一清理服务器间中转临时目录，暂停时跳过，完成/取消/失败时复用这一处收口。
async function cleanupRemoteTransferTempDirectory(taskId: string, tempDirectoryPath?: string): Promise<void> {
  if (!tempDirectoryPath) {
    return
  }

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

function openRemoteWriteHandle(sftp: RawSftpClient, path: string, flags: 'w' | 'r+'): Promise<Buffer> {
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

function writeRemoteChunk(sftp: RawSftpClient, handle: Buffer, buffer: Buffer, position: number): Promise<void> {
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

function joinRemotePath(parentPath: string, childName: string): string {
  const normalizedParentPath = normalizeRemotePath(parentPath)
  const pathPrefix = normalizedParentPath.endsWith('/') ? normalizedParentPath : `${normalizedParentPath}/`

  return `${pathPrefix}${childName.replace(/\\/g, '/')}`.replace(/\/+/g, '/')
}

function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function getServerSshTarget(server: ServerAuthConfig): string {
  return `${server.username}@${server.host}`
}

function getUploadDisplayName(localPaths: string[]): string {
  if (localPaths.length === 1) {
    return basename(localPaths[0])
  }

  return `${localPaths.length} 个项目`
}

function getRemoteTransferDisplayName(sources: SftpRemoteTransferSource[]): string {
  if (sources.length === 1) {
    return sources[0].name
  }

  return `${sources.length} 个项目`
}

function createSftpClient(name: string, server: ServerAuthConfig): Promise<SftpClient> {
  const client = new SftpClient(name)

  return client
    .connect({
      ...createServerConnectOptions(server),
      readyTimeout: 15000,
      keepaliveInterval: getSshKeepaliveIntervalMs()
    })
    .then(() => client)
}

function createSshClient(server: ServerAuthConfig): Promise<SshClient> {
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

function execSshCommand(client: SshClient, command: string): Promise<{ stdout: string; stderr: string }> {
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

async function collectUploadFileEntries(
  localPath: string,
  remoteDirectoryPath: string,
  rootLocalPath = localPath
): Promise<UploadFileEntry[]> {
  const localStat = await statLocalFile(localPath)
  const rootName = basename(rootLocalPath)

  if (localStat.isFile()) {
    const relativePath = localPath === rootLocalPath ? basename(localPath) : relative(dirname(rootLocalPath), localPath)

    return [
      {
        localPath,
        remotePath: joinRemotePath(remoteDirectoryPath, relativePath),
        size: localStat.size
      }
    ]
  }

  if (!localStat.isDirectory()) {
    return []
  }

  const entries = await readdir(localPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) =>
      collectUploadFileEntries(joinLocalPath(localPath, entry.name), remoteDirectoryPath, rootLocalPath)
    )
  )

  // 空目录没有文件进度，但需要在远程侧保留目录本身。
  if (entries.length === 0) {
    return [
      {
        localPath,
        remotePath: joinRemotePath(remoteDirectoryPath, rootName),
        size: 0
      }
    ]
  }

  return files.flat()
}

async function collectUploadEntries(localPaths: string[], remoteDirectoryPath: string): Promise<UploadFileEntry[]> {
  const entries = await Promise.all(
    localPaths.map((localPath) => collectUploadFileEntries(localPath, remoteDirectoryPath))
  )

  return entries.flat()
}

function getCompletedUploadBytes(entries: UploadFileEntry[], completedRemotePaths: Set<string>): number {
  return entries.reduce(
    (total, entry) => completedRemotePaths.has(entry.remotePath) ? total + entry.size : total,
    0
  )
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

function getSftpSession(tabId: string): SftpSession {
  const session = sftpSessions.get(tabId)

  if (!session) {
    throw new Error('SFTP 会话不存在')
  }

  session.lastActiveAt = Date.now()
  return session
}

async function closeIdleSftpSessions(): Promise<void> {
  const idleDisconnectMs = getIdleDisconnectMs()

  if (idleDisconnectMs <= 0) {
    return
  }

  const now = Date.now()
  const idleSessions = [...sftpSessions.values()].filter(
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
    client,
    homePath,
    lastActiveAt: Date.now()
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

export async function uploadLocalPathsToRemoteDirectory(
  tabId: string,
  remoteDirectoryPath: string,
  localPaths: string[],
  task: Pick<SftpUploadProgressEvent, 'taskId'>,
  onProgress?: (event: SftpUploadProgressEvent) => void,
  resumeState?: Pick<PausedUploadTask, 'completedRemotePaths' | 'currentRemotePath' | 'transferredBytes' | 'totalBytes'>
): Promise<SftpUploadResult> {
  const session = getSftpSession(tabId)
  const normalizedRemoteDirectoryPath = normalizeRemotePath(remoteDirectoryPath)
  const normalizedLocalPaths = localPaths.filter(Boolean)
  const server = getServerAuthConfig(session.serverId)
  const uploadClient = new SftpClient(`upload-${task.taskId}`)
  const name = getUploadDisplayName(normalizedLocalPaths)
  const entries = await collectUploadEntries(normalizedLocalPaths, normalizedRemoteDirectoryPath)
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0)
  const completedRemotePaths = new Set(resumeState?.completedRemotePaths ?? [])
  let transferredBytes = Math.min(resumeState?.transferredBytes ?? 0, totalBytes)
  let lastProgressAt = 0
  let lastSpeedAt = Date.now()
  let lastSpeedBytes = transferredBytes
  let currentSpeedBytesPerSecond = 0
  let wasCanceled = false
  let wasPaused = false

  if (normalizedLocalPaths.length === 0) {
    return {
      uploaded: false,
      remoteDirectoryPath: normalizedRemoteDirectoryPath,
      uploadedCount: 0
    }
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
      name,
      path: normalizedRemoteDirectoryPath,
      status,
      transferredBytes,
      totalBytes,
      speedBytesPerSecond: status === 'started' ? 0 : currentSpeedBytesPerSecond,
      localPaths: normalizedLocalPaths,
      remoteDirectoryPath: normalizedRemoteDirectoryPath,
      error
    })
  }
  const uploadTask: UploadRuntimeTask = {
    client: uploadClient,
    tabId,
    name,
    localPaths: normalizedLocalPaths,
    remoteDirectoryPath: normalizedRemoteDirectoryPath,
    paused: false,
    canceled: false,
    completedRemotePaths,
    currentRemotePath: resumeState?.currentRemotePath,
    transferredBytes,
    totalBytes,
    emitProgress
  }

  activeUploadTasks.set(task.taskId, uploadTask)
  emitProgress('started')

  try {
    await uploadClient.connect({
      ...createServerConnectOptions(server),
      readyTimeout: 15000,
      keepaliveInterval: getSshKeepaliveIntervalMs()
    })
    await uploadClient.mkdir(normalizedRemoteDirectoryPath, true)

    for (const entry of entries) {
      if (uploadTask.paused || uploadTask.canceled) {
        break
      }

      if (uploadTask.completedRemotePaths.has(entry.remotePath)) {
        continue
      }

      const localStat = await statLocalFile(entry.localPath)

      if (localStat.isDirectory()) {
        await uploadClient.mkdir(entry.remotePath, true)
        uploadTask.completedRemotePaths.add(entry.remotePath)
        continue
      }

      await uploadClient.mkdir(dirname(entry.remotePath).replace(/\\/g, '/'), true)
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
        entry.remotePath,
        entry.size,
        shouldResumeEntry,
        safeUploadResumeOffset
      )

      uploadTask.currentRemotePath = entry.remotePath
      transferredBytes = entryBaseTransferred + uploadResumeOffset
      uploadTask.transferredBytes = transferredBytes
      emitProgress('progress')

      if (shouldResumeEntry) {
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
      } else {
        await uploadClient.fastPut(entry.localPath, entry.remotePath, {
          concurrency: appConfig.sftp.download.fastGetConcurrency,
          chunkSize: appConfig.sftp.download.fastGetChunkSizeBytes,
          step: (totalTransferred) => {
            const now = Date.now()
            transferredBytes = entryBaseTransferred + totalTransferred
            uploadTask.transferredBytes = transferredBytes

            if (!uploadTask.paused && !uploadTask.canceled && now - lastProgressAt >= appConfig.sftp.download.progressIntervalMs) {
              lastProgressAt = now
              emitProgress('progress')
            }
          }
        })
      }

      if (uploadTask.paused || uploadTask.canceled) {
        break
      }

      uploadTask.completedRemotePaths.add(entry.remotePath)
      uploadTask.currentRemotePath = undefined
      transferredBytes = entryBaseTransferred + entry.size
      uploadTask.transferredBytes = transferredBytes
    }

    if (uploadTask.canceled) {
      wasCanceled = true
    } else if (uploadTask.paused) {
      wasPaused = true
    } else {
      transferredBytes = totalBytes
      uploadTask.transferredBytes = transferredBytes
      emitProgress('completed')
    }
  } catch (error) {
    if (uploadTask.canceled) {
      wasCanceled = true
    } else if (uploadTask.paused) {
      wasPaused = true
    } else {
      emitProgress('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  } finally {
    const isCurrentTask = activeUploadTasks.get(task.taskId) === uploadTask

    if (isCurrentTask) {
      activeUploadTasks.delete(task.taskId)
    }
    await uploadClient.end().catch(() => undefined)

    if (isCurrentTask && wasPaused) {
      pausedUploadTasks.set(task.taskId, {
        tabId,
        name,
        localPaths: normalizedLocalPaths,
        remoteDirectoryPath: normalizedRemoteDirectoryPath,
        completedRemotePaths: [...uploadTask.completedRemotePaths],
        currentRemotePath: uploadTask.currentRemotePath,
        transferredBytes,
        totalBytes
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
      uploadedCount: entries.length
    }
  })

  return {
    uploaded: entries.length > 0,
    taskId: task.taskId,
    remoteDirectoryPath: normalizedRemoteDirectoryPath,
    uploadedCount: entries.length
  }
}

export async function controlRemoteUploadTask(
  taskId: string,
  action: 'pause' | 'resume' | 'cancel',
  onProgress?: (event: SftpUploadProgressEvent) => void
): Promise<boolean> {
  const resumePausedTask = (pausedTask: PausedUploadTask): boolean => {
    pausedUploadTasks.delete(taskId)
    void uploadLocalPathsToRemoteDirectory(
      pausedTask.tabId,
      pausedTask.remoteDirectoryPath,
      pausedTask.localPaths,
      { taskId },
      onProgress,
      {
        completedRemotePaths: pausedTask.completedRemotePaths,
        currentRemotePath: pausedTask.currentRemotePath,
        transferredBytes: pausedTask.transferredBytes,
        totalBytes: pausedTask.totalBytes
      }
    ).catch((error) => {
      onProgress?.({
        taskId,
        tabId: pausedTask.tabId,
        name: pausedTask.name,
        path: pausedTask.remoteDirectoryPath,
        status: 'error',
        transferredBytes: pausedTask.transferredBytes,
        totalBytes: pausedTask.totalBytes,
        speedBytesPerSecond: 0,
        localPaths: pausedTask.localPaths,
        remoteDirectoryPath: pausedTask.remoteDirectoryPath,
        error: error instanceof Error ? error.message : String(error)
      })
    })

    return true
  }

  const task = activeUploadTasks.get(taskId)

  if (task) {
    if (action === 'pause') {
      task.paused = true
      pausedUploadTasks.set(taskId, createPausedUploadTask(task))
      task.emitProgress('paused')
      stopUploadConnection(taskId, task, 'pause')
      return true
    }

    if (action === 'cancel') {
      task.canceled = true
      pausedUploadTasks.delete(taskId)
      task.emitProgress('canceled')
      stopUploadConnection(taskId, task, 'cancel')
      return true
    }

    if (action === 'resume' && task.paused) {
      const pausedTask = pausedUploadTasks.get(taskId)

      if (!pausedTask) {
        return false
      }

      activeUploadTasks.delete(taskId)
      stopUploadConnection(taskId, task, 'pause')
      return resumePausedTask(pausedTask)
    }

    return false
  }

  const pausedTask = pausedUploadTasks.get(taskId)

  if (!pausedTask) {
    return false
  }

  if (action === 'cancel') {
    pausedUploadTasks.delete(taskId)
    onProgress?.({
      taskId,
      tabId: pausedTask.tabId,
      name: pausedTask.name,
      path: pausedTask.remoteDirectoryPath,
      status: 'canceled',
      transferredBytes: pausedTask.transferredBytes,
      totalBytes: pausedTask.totalBytes,
      speedBytesPerSecond: 0,
      localPaths: pausedTask.localPaths,
      remoteDirectoryPath: pausedTask.remoteDirectoryPath
    })
    return true
  }

  if (action !== 'resume') {
    return false
  }

  return resumePausedTask(pausedTask)
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

async function getRemoteUploadResumeOffset(
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

async function uploadLocalFileToRemote(
  task: PausableTransferTask,
  client: SftpClient,
  localPath: string,
  remotePath: string,
  totalBytes: number,
  resumeOffset: number,
  onChunk: (transferredBytes: number) => void
): Promise<void> {
  const rawSftp = getRawSftpClient(client)

  if (totalBytes === 0) {
    const emptyRemoteHandle = await openRemoteWriteHandle(rawSftp, remotePath, 'w')

    await closeRemoteHandle(rawSftp, emptyRemoteHandle).catch(() => undefined)
    onChunk(0)
    return
  }

  if (resumeOffset > 0) {
    // 目标端已有半成品时从对应偏移继续写，避免上传阶段暂停后回到 50% 重新上传。
    onChunk(resumeOffset)
  }

  if (resumeOffset >= totalBytes) {
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
    remoteHandle = await openRemoteWriteHandle(rawSftp, remotePath, resumeOffset > 0 ? 'r+' : 'w')

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

        // 断点上传并发写入剩余分块，但进度只推进到连续完成的位置，保证下一次暂停仍能安全续传。
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
    'completedSourcePaths' | 'tempDirectoryPath' | 'transferredBytes' | 'totalBytes' | 'phase'
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
        speedBytesPerSecond: ['started', 'paused', 'canceled', 'error'].includes(status) ? 0 : currentSpeedBytesPerSecond,
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

    if (task.paused || task.canceled) {
      // 目录收集阶段已收到暂停/取消请求，避免继续进入直连或本地中转。
    } else if (!resumeState && entries.length > 0) {
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

    if (!task.paused && !task.canceled) {
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
      transferredCount: entries.length
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
    void transferRemoteSourcesBetweenServers(
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
        phase: pausedTask.phase
      }
    ).catch((error) => {
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
      readyTimeout: 15000,
      keepaliveInterval: getSshKeepaliveIntervalMs()
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
