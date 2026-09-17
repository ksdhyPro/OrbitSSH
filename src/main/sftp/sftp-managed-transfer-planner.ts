import type SftpClient from 'ssh2-sftp-client'

import { basename, join as joinLocalPath, posix as posixPath } from 'node:path'

import { appConfig } from '../../shared/config.js'
import type {
  RemoteFileNode,
  SftpRemoteTransferSource
} from '../../shared/sftp.js'
import { acquireSftpConnection } from './sftp-connection-pool.js'
import { getSftpSession } from './sftp-session-registry.js'
import { createUploadPlan } from './sftp-upload-transfer.js'
import {
  joinRemotePath,
  lstatRemotePath,
  normalizeRemotePath
} from './sftp-transfer-common.js'

export interface ManagedTransferPlanEntry {
  relativePath: string
  name: string
  type: RemoteFileNode['type']
  size: number
  sourcePath: string
  targetPath: string
  sourceModifyTime?: number
}

export interface ManagedTransferPlan {
  name: string
  entries: ManagedTransferPlanEntry[]
  sourceLabel: string
  targetLabel: string
}

interface ScanState {
  count: number
}

function assertScanLimit(state: ScanState, depth: number): void {
  if (depth > appConfig.sftp.upload.maxScanDepth) {
    throw new Error(`目录层级超过 ${appConfig.sftp.upload.maxScanDepth} 层，请拆分后重试`)
  }

  state.count += 1
  if (state.count > appConfig.sftp.upload.maxScanEntries) {
    throw new Error(`单批次项目数量超过 ${appConfig.sftp.upload.maxScanEntries} 个，请拆分后重试`)
  }
}

function assertSafeRemoteName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('远程目录包含不安全的文件名，已停止传输')
  }
}

async function collectRemoteEntries(
  client: SftpClient,
  sourcePath: string,
  targetPath: string,
  relativePath: string,
  type: RemoteFileNode['type'],
  size: number,
  sourceModifyTime: number | undefined,
  depth: number,
  state: ScanState,
  entries: ManagedTransferPlanEntry[],
  targetKind: 'local' | 'remote'
): Promise<void> {
  assertScanLimit(state, depth)
  const name = posixPath.basename(relativePath)
  entries.push({
    relativePath,
    name,
    type,
    size,
    sourcePath,
    targetPath,
    sourceModifyTime
  })

  if (type !== 'directory') return

  const children = await client.list(sourcePath)
  children.sort((left, right) => {
    if ((left.type === 'd') !== (right.type === 'd')) return left.type === 'd' ? -1 : 1
    return left.name.localeCompare(right.name)
  })

  for (const child of children) {
    assertSafeRemoteName(child.name)
    if (child.type === 'l') {
      throw new Error(`暂不支持符号链接：${joinRemotePath(sourcePath, child.name)}`)
    }

    const childSourcePath = joinRemotePath(sourcePath, child.name)
    const childRelativePath = `${relativePath}/${child.name}`
    const childTargetPath = targetKind === 'local'
      ? joinLocalPath(targetPath, child.name)
      : joinRemotePath(targetPath, child.name)

    await collectRemoteEntries(
      client,
      childSourcePath,
      childTargetPath,
      childRelativePath,
      child.type === 'd' ? 'directory' : 'file',
      child.size ?? 0,
      child.modifyTime,
      depth + 1,
      state,
      entries,
      targetKind
    )
  }
}

export async function createManagedUploadPlan(
  remoteDirectoryPath: string,
  localPaths: string[]
): Promise<ManagedTransferPlan> {
  const uploadPlan = await createUploadPlan(remoteDirectoryPath, localPaths)

  return {
    name: uploadPlan.name,
    sourceLabel: localPaths.length === 1 ? localPaths[0] : `${localPaths.length} 个本地项目`,
    targetLabel: normalizeRemotePath(remoteDirectoryPath),
    entries: uploadPlan.entries.map(entry => ({
      relativePath: entry.relativePath,
      name: basename(entry.localPath),
      type: entry.type,
      size: entry.size,
      sourcePath: entry.localPath,
      targetPath: entry.remotePath,
      sourceModifyTime: entry.modifyTime
    }))
  }
}

export async function createManagedDownloadPlan(
  tabId: string,
  remotePath: string,
  name: string,
  type: RemoteFileNode['type'],
  localTargetPath: string,
  size = 0
): Promise<ManagedTransferPlan> {
  const session = getSftpSession(tabId)
  const entries: ManagedTransferPlanEntry[] = []
  const normalizedRemotePath = normalizeRemotePath(remotePath)
  let resolvedSize = size
  let sourceModifyTime: number | undefined

  if (type === 'file') {
    const metadata = await lstatRemotePath(session.client, normalizedRemotePath)
    if (metadata.isSymbolicLink) throw new Error(`暂不支持符号链接：${normalizedRemotePath}`)
    resolvedSize = metadata.size ?? resolvedSize
    sourceModifyTime = metadata.modifyTime
  }

  await collectRemoteEntries(
    session.client,
    normalizedRemotePath,
    localTargetPath,
    name,
    type,
    resolvedSize,
    sourceModifyTime,
    0,
    { count: 0 },
    entries,
    'local'
  )

  return {
    name,
    sourceLabel: normalizedRemotePath,
    targetLabel: localTargetPath,
    entries
  }
}

export async function createManagedRelayPlan(
  sourceServerId: string,
  targetServerId: string,
  sources: SftpRemoteTransferSource[],
  targetDirectoryPath: string
): Promise<ManagedTransferPlan> {
  const normalizedTargetDirectory = normalizeRemotePath(targetDirectoryPath)
  if (sourceServerId === targetServerId) {
    for (const source of sources) {
      const normalizedSource = normalizeRemotePath(source.path)
      const finalTarget = joinRemotePath(normalizedTargetDirectory, source.name)
      const targetInsideSource = source.type === 'directory'
        && (normalizedTargetDirectory === normalizedSource
          || normalizedTargetDirectory.startsWith(`${normalizedSource}/`))

      if (finalTarget === normalizedSource || targetInsideSource) {
        throw new Error('源路径与目标路径相同，或目标目录位于源目录内部，无法传输')
      }
    }
  }

  const lease = await acquireSftpConnection(sourceServerId, 'relay-plan')
  const entries: ManagedTransferPlanEntry[] = []
  const state: ScanState = { count: 0 }

  try {
    for (const source of sources) {
      const sourcePath = normalizeRemotePath(source.path)
      const targetPath = joinRemotePath(normalizedTargetDirectory, source.name)
      let size = source.size ?? 0
      let sourceModifyTime: number | undefined

      if (source.type === 'file') {
        const metadata = await lstatRemotePath(lease.client, sourcePath)
        if (metadata.isSymbolicLink) throw new Error(`暂不支持符号链接：${sourcePath}`)
        if (!metadata.isFile) throw new Error(`传输源文件不存在或类型已变化：${sourcePath}`)
        size = metadata.size ?? size
        sourceModifyTime = metadata.modifyTime
      }

      await collectRemoteEntries(
        lease.client,
        sourcePath,
        targetPath,
        source.name,
        source.type,
        size,
        sourceModifyTime,
        0,
        state,
        entries,
        'remote'
      )
    }
  } finally {
    await lease.release()
  }

  return {
    name: sources.length === 1 ? sources[0].name : `${sources.length} 个项目`,
    sourceLabel: sources.length === 1 ? sources[0].path : `${sources.length} 个远程项目`,
    targetLabel: normalizedTargetDirectory,
    entries
  }
}
