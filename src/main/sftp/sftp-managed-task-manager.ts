import type { WebContents } from 'electron'

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rm } from 'node:fs/promises'

import { appConfig } from '../../shared/config.js'
import type {
  SftpManagedTaskBatch,
  SftpManagedTaskControlInput,
  SftpManagedTaskEvent,
  SftpManagedTaskNode,
  SftpManagedTaskSnapshot
} from '../../shared/sftp.js'
import {
  SFTP_TRANSFER_CONCURRENCY_MAX,
  SFTP_TRANSFER_CONCURRENCY_MIN
} from '../../shared/settings.js'
import { writeAppLog } from '../logger.js'
import { acquireSftpConnection } from './sftp-connection-pool.js'
import { getTransferTempPath, lstatRemotePath } from './sftp-transfer-common.js'
import {
  createRelayTempPath,
  executeManagedFileTransfer,
  getRelayTempRoot,
  type ManagedFileTransferInput,
  type ManagedTransferControl
} from './sftp-managed-transfer-executor.js'
import type {
  ManagedTransferPlan
} from './sftp-managed-transfer-planner.js'

interface ManagedNodeState extends SftpManagedTaskNode {
  children: Set<string>
  workItem: boolean
  sourcePath: string
  targetPath: string
  sourceModifyTime?: number
  control?: ManagedTransferControl
  deleted?: boolean
}

interface ManagedBatchState {
  snapshot: SftpManagedTaskBatch
  nodes: Map<string, ManagedNodeState>
  emitter: (event: SftpManagedTaskEvent) => void
  sourceServerId?: string
  targetServerId?: string
  roundRobinCursor: number
}

interface CreateManagedBatchInput {
  taskId?: string
  direction: SftpManagedTaskBatch['direction']
  plan: ManagedTransferPlan
  sender: WebContents
  sourceServerId?: string
  targetServerId?: string
}

const MAX_GLOBAL_UNFINISHED_ITEMS = 50_000
const batches = new Map<string, ManagedBatchState>()
const batchOrder: string[] = []
const activeTargetKeys = new Set<string>()
let activeWorkerCount = 0
let nextBatchIndex = 0
let maxWorkers: number = appConfig.sftp.transfer.maxConcurrentTasks

function emitToSender(sender: WebContents, event: SftpManagedTaskEvent): void {
  if (!sender.isDestroyed()) sender.send('sftp:managed-task-event', event)
}

function countGlobalWorkItems(): number {
  let count = 0
  for (const batch of batches.values()) count += batch.snapshot.remainingCount
  return count
}

function getNodeSnapshot(node: ManagedNodeState): SftpManagedTaskNode {
  const { children: _children, workItem: _workItem, sourcePath: _sourcePath,
    targetPath: _targetPath, sourceModifyTime: _sourceModifyTime,
    control: _control, deleted: _deleted, ...snapshot } = node
  return snapshot
}

function emitNode(batch: ManagedBatchState, node: ManagedNodeState): void {
  if (!node.deleted) batch.emitter({ type: 'node-upsert', node: getNodeSnapshot(node) })
}

function emitBatch(batch: ManagedBatchState): void {
  batch.emitter({ type: 'batch-upsert', batch: { ...batch.snapshot } })
}

function getAncestors(batch: ManagedBatchState, node: ManagedNodeState): ManagedNodeState[] {
  const ancestors: ManagedNodeState[] = []
  let parentId = node.parentId

  while (parentId) {
    const parent = batch.nodes.get(parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parentId
  }

  return ancestors
}

function getDescendants(batch: ManagedBatchState, nodeId: string): ManagedNodeState[] {
  const root = batch.nodes.get(nodeId)
  if (!root) return []

  const result: ManagedNodeState[] = [root]
  for (let index = 0; index < result.length; index += 1) {
    const current = result[index]
    for (const childId of current.children) {
      const child = batch.nodes.get(childId)
      if (child) result.push(child)
    }
  }
  return result
}

function deriveContainerStatus(
  batch: ManagedBatchState,
  node?: ManagedNodeState
): SftpManagedTaskBatch['status'] {
  const candidates = node
    ? getDescendants(batch, node.id).filter(candidate => candidate.workItem && candidate.id !== node.id)
    : [...batch.nodes.values()].filter(candidate => candidate.workItem)

  if (candidates.some(candidate => candidate.status === 'transferring')) return 'transferring'
  if (candidates.some(candidate => candidate.status === 'queued')) return 'queued'
  if (candidates.some(candidate => candidate.status === 'paused')) return 'paused'
  return 'failed'
}

function refreshContainers(batch: ManagedBatchState, node: ManagedNodeState): void {
  for (const ancestor of getAncestors(batch, node)) {
    ancestor.status = deriveContainerStatus(batch, ancestor)
    ancestor.speedBytesPerSecond = [...ancestor.children]
      .map(childId => batch.nodes.get(childId)?.speedBytesPerSecond ?? 0)
      .reduce((total, speed) => total + speed, 0)
    emitNode(batch, ancestor)
  }

  batch.snapshot.status = deriveContainerStatus(batch)
  batch.snapshot.speedBytesPerSecond = [...batch.nodes.values()]
    .filter(candidate => candidate.workItem)
    .reduce((total, candidate) => total + candidate.speedBytesPerSecond, 0)
  emitBatch(batch)
}

function applyProgressDelta(
  batch: ManagedBatchState,
  node: ManagedNodeState,
  transferredBytes: number,
  speedBytesPerSecond: number
): void {
  const boundedBytes = Math.min(Math.max(transferredBytes, 0), node.totalBytes)
  const delta = boundedBytes - node.transferredBytes
  node.transferredBytes = boundedBytes
  node.speedBytesPerSecond = speedBytesPerSecond
  batch.snapshot.transferredBytes += delta

  for (const ancestor of getAncestors(batch, node)) {
    ancestor.transferredBytes += delta
  }

  emitNode(batch, node)
  refreshContainers(batch, node)
}

function removeBatch(batch: ManagedBatchState): void {
  batches.delete(batch.snapshot.taskId)
  const index = batchOrder.indexOf(batch.snapshot.taskId)
  if (index >= 0) batchOrder.splice(index, 1)
  batch.emitter({ type: 'batch-remove', taskId: batch.snapshot.taskId })
}

function removeCompletedNode(batch: ManagedBatchState, node: ManagedNodeState): void {
  if (node.deleted) return
  node.deleted = true
  batch.nodes.delete(node.id)
  batch.snapshot.remainingCount = Math.max(batch.snapshot.remainingCount - (node.workItem ? 1 : 0), 0)
  batch.emitter({ type: 'node-remove', taskId: batch.snapshot.taskId, nodeId: node.id })

  if (node.parentId) {
    const parent = batch.nodes.get(node.parentId)
    if (parent) {
      parent.children.delete(node.id)
      parent.childCount = parent.children.size
      if (parent.children.size === 0 && !parent.workItem) {
        removeCompletedNode(batch, parent)
      } else {
        emitNode(batch, parent)
      }
    }
  }

  if (batch.nodes.size === 0 || batch.snapshot.remainingCount === 0) {
    removeBatch(batch)
  } else {
    batch.snapshot.status = deriveContainerStatus(batch)
    emitBatch(batch)
  }
}

function deleteNode(batch: ManagedBatchState, node: ManagedNodeState): void {
  const subtree = getDescendants(batch, node.id)
  const workItems = subtree.filter(candidate => candidate.workItem)
  const removedTotalBytes = workItems.reduce((total, item) => total + item.totalBytes, 0)
  const removedTransferredBytes = workItems.reduce(
    (total, item) => total + item.transferredBytes,
    0
  )

  batch.snapshot.totalBytes = Math.max(batch.snapshot.totalBytes - removedTotalBytes, 0)
  batch.snapshot.transferredBytes = Math.max(
    batch.snapshot.transferredBytes - removedTransferredBytes,
    0
  )

  for (const ancestor of getAncestors(batch, node)) {
    ancestor.totalBytes = Math.max(ancestor.totalBytes - removedTotalBytes, 0)
    ancestor.transferredBytes = Math.max(
      ancestor.transferredBytes - removedTransferredBytes,
      0
    )
  }

  for (const item of subtree.reverse()) {
    item.control && (item.control.canceled = true)
    void cleanupNodeArtifacts(batch, item)
    if (item.deleted) continue
    item.deleted = true
    batch.nodes.delete(item.id)
    if (item.workItem) {
      batch.snapshot.remainingCount = Math.max(batch.snapshot.remainingCount - 1, 0)
    }
    batch.emitter({ type: 'node-remove', taskId: batch.snapshot.taskId, nodeId: item.id })
  }

  if (node.parentId) {
    const parent = batch.nodes.get(node.parentId)
    if (parent) {
      parent.children.delete(node.id)
      parent.childCount = parent.children.size
      if (parent.children.size === 0 && !parent.workItem) removeCompletedNode(batch, parent)
      else emitNode(batch, parent)
    }
  }

  if (batch.nodes.size === 0 || batch.snapshot.remainingCount === 0) removeBatch(batch)
  else emitBatch(batch)
}

async function cleanupNodeArtifacts(
  batch: ManagedBatchState,
  node: ManagedNodeState
): Promise<void> {
  if (batch.snapshot.direction === 'server-transfer') {
    await rm(createRelayTempPath(batch.snapshot.taskId, node.relativePath), {
      recursive: true,
      force: true
    }).catch(() => undefined)
  }

  if (node.type !== 'file' || batch.snapshot.direction === 'download') return
  const serverId = batch.targetServerId
  if (!serverId) return

  try {
    const lease = await acquireSftpConnection(serverId, `${node.id}-cleanup`)
    try {
      await lease.client.delete(`${node.targetPath}.download`).catch(() => undefined)
    } finally {
      await lease.release()
    }
  } catch {
    // 删除任务以立即从界面移除为准，连接不可用时退出清理仍会删除本地中转文件。
  }
}

function getTargetKey(batch: ManagedBatchState, node: ManagedNodeState): string {
  return `${batch.targetServerId ?? 'local'}:${node.targetPath}`
}

function getNextRunnableNode(batch: ManagedBatchState): ManagedNodeState | undefined {
  const workItems = [...batch.nodes.values()].filter(node => node.workItem && !node.deleted)
  if (workItems.length === 0) return undefined

  for (let offset = 0; offset < workItems.length; offset += 1) {
    const index = (batch.roundRobinCursor + offset) % workItems.length
    const node = workItems[index]
    const targetKey = getTargetKey(batch, node)
    const hasPendingDirectoryAncestor = getAncestors(batch, node).some(
      ancestor => ancestor.type === 'directory' && ancestor.workItem
    )

    if (
      node.status === 'queued'
      && !hasPendingDirectoryAncestor
      && !activeTargetKeys.has(targetKey)
    ) {
      batch.roundRobinCursor = (index + 1) % workItems.length
      return node
    }
  }

  return undefined
}

async function executeDirectoryJob(
  batch: ManagedBatchState,
  node: ManagedNodeState
): Promise<'completed' | 'paused' | 'canceled'> {
  const control = node.control as ManagedTransferControl
  if (control.paused) return 'paused'
  if (control.canceled) return 'canceled'

  if (batch.snapshot.direction === 'download') {
    await rm(node.targetPath, { force: true }).catch(() => undefined)
    await mkdir(node.targetPath, { recursive: true })
    return 'completed'
  }

  const serverId = batch.targetServerId
  if (!serverId) throw new Error('目标服务器不存在')
  const lease = await acquireSftpConnection(serverId, node.id)

  try {
    try {
      const stat = await lease.client.stat(node.targetPath)
      if (!stat.isDirectory) await lease.client.delete(node.targetPath)
    } catch {
      // 目标不存在时直接创建目录。
    }
    await lease.client.mkdir(node.targetPath, true)
    return 'completed'
  } finally {
    await lease.release()
  }
}

function createFileInput(
  batch: ManagedBatchState,
  node: ManagedNodeState
): ManagedFileTransferInput {
  const common = {
    nodeId: node.id,
    size: node.totalBytes / (batch.snapshot.direction === 'server-transfer' ? 2 : 1),
    control: node.control as ManagedTransferControl,
    onProgress: (bytes: number, speed: number) => applyProgressDelta(batch, node, bytes, speed)
  }

  if (batch.snapshot.direction === 'upload') {
    return {
      ...common,
      kind: 'upload',
      serverId: batch.targetServerId as string,
      localPath: node.sourcePath,
      remotePath: node.targetPath,
      expectedModifyTime: node.sourceModifyTime
    }
  }

  if (batch.snapshot.direction === 'download') {
    return {
      ...common,
      kind: 'download',
      serverId: batch.sourceServerId as string,
      remotePath: node.sourcePath,
      localPath: node.targetPath,
      expectedModifyTime: node.sourceModifyTime
    }
  }

  return {
    ...common,
    kind: 'relay',
    sourceServerId: batch.sourceServerId as string,
    targetServerId: batch.targetServerId as string,
    sourcePath: node.sourcePath,
    targetPath: node.targetPath,
    localPath: createRelayTempPath(batch.snapshot.taskId, node.relativePath),
    expectedModifyTime: node.sourceModifyTime
  }
}

async function runNode(batch: ManagedBatchState, node: ManagedNodeState): Promise<void> {
  const targetKey = getTargetKey(batch, node)
  const control: ManagedTransferControl = { paused: false, canceled: false }
  node.control = control
  node.status = 'transferring'
  node.error = undefined
  activeTargetKeys.add(targetKey)
  emitNode(batch, node)
  refreshContainers(batch, node)

  try {
    const result = node.type === 'directory'
      ? await executeDirectoryJob(batch, node)
      : await executeManagedFileTransfer(createFileInput(batch, node))

    if (node.deleted) return
    if (result === 'completed') {
      if (node.type === 'directory' && node.children.size > 0) {
        // 非空目录先完成目标目录准备，再作为容器保留到所有子项完成。
        node.workItem = false
        batch.snapshot.remainingCount = Math.max(batch.snapshot.remainingCount - 1, 0)
        node.status = deriveContainerStatus(batch, node)
        emitNode(batch, node)
        refreshContainers(batch, node)
        return
      }
      applyProgressDelta(batch, node, node.totalBytes, 0)
      removeCompletedNode(batch, node)
    } else if (result === 'paused') {
      node.status = 'paused'
      node.speedBytesPerSecond = 0
      emitNode(batch, node)
      refreshContainers(batch, node)
    } else {
      deleteNode(batch, node)
    }
  } catch (error) {
    if (node.deleted) return
    node.status = control.paused ? 'paused' : 'failed'
    node.speedBytesPerSecond = 0
    node.error = control.paused
      ? undefined
      : error instanceof Error ? error.message : String(error)
    emitNode(batch, node)
    refreshContainers(batch, node)
  } finally {
    node.control = undefined
    activeTargetKeys.delete(targetKey)
  }
}

function runScheduler(): void {
  while (activeWorkerCount < maxWorkers && batchOrder.length > 0) {
    let selectedBatch: ManagedBatchState | undefined
    let selectedNode: ManagedNodeState | undefined

    for (let offset = 0; offset < batchOrder.length; offset += 1) {
      const index = (nextBatchIndex + offset) % batchOrder.length
      const batch = batches.get(batchOrder[index])
      if (!batch) continue
      const node = getNextRunnableNode(batch)
      if (!node) continue
      selectedBatch = batch
      selectedNode = node
      nextBatchIndex = (index + 1) % Math.max(batchOrder.length, 1)
      break
    }

    if (!selectedBatch || !selectedNode) return

    activeWorkerCount += 1
    void runNode(selectedBatch, selectedNode)
      .catch((error) => {
        writeAppLog({
          scope: 'main.sftp.tasks',
          level: 'error',
          message: '文件级传输任务异常退出',
          data: {
            taskId: selectedBatch?.snapshot.taskId,
            nodeId: selectedNode?.id,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      })
      .finally(() => {
        activeWorkerCount = Math.max(activeWorkerCount - 1, 0)
        runScheduler()
      })
  }
}

function buildNodes(taskId: string, plan: ManagedTransferPlan, multiplier: number): Map<string, ManagedNodeState> {
  const nodes = new Map<string, ManagedNodeState>()
  const nodesByRelativePath = new Map<string, ManagedNodeState>()

  for (const entry of plan.entries) {
    const parentPath = entry.relativePath.includes('/')
      ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/'))
      : undefined
    const parent = parentPath ? nodesByRelativePath.get(parentPath) : undefined
    const node: ManagedNodeState = {
      id: randomUUID(),
      taskId,
      parentId: parent?.id,
      name: entry.name,
      relativePath: entry.relativePath,
      type: entry.type,
      status: 'queued',
      transferredBytes: 0,
      totalBytes: entry.type === 'file' ? entry.size * multiplier : 0,
      speedBytesPerSecond: 0,
      childCount: 0,
      children: new Set(),
      workItem: false,
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
      sourceModifyTime: entry.sourceModifyTime
    }
    nodes.set(node.id, node)
    nodesByRelativePath.set(entry.relativePath, node)
    parent?.children.add(node.id)
  }

  for (const node of nodes.values()) {
    node.childCount = node.children.size
    node.workItem = true
  }

  const byDepth = [...nodes.values()].sort(
    (left, right) => right.relativePath.split('/').length - left.relativePath.split('/').length
  )
  for (const node of byDepth) {
    if (!node.parentId) continue
    const parent = nodes.get(node.parentId)
    if (parent) parent.totalBytes += node.totalBytes
  }

  return nodes
}

export function createManagedTransferBatch(input: CreateManagedBatchInput): string {
  const taskId = input.taskId ?? randomUUID()
  const multiplier = input.direction === 'server-transfer' ? 2 : 1
  const nodes = buildNodes(taskId, input.plan, multiplier)
  const remainingCount = [...nodes.values()].filter(node => node.workItem).length

  if (countGlobalWorkItems() + remainingCount > MAX_GLOBAL_UNFINISHED_ITEMS) {
    throw new Error(`全局未完成任务数量不能超过 ${MAX_GLOBAL_UNFINISHED_ITEMS} 项`)
  }

  const totalBytes = [...nodes.values()]
    .filter(node => !node.parentId)
    .reduce((total, node) => total + node.totalBytes, 0)
  const batch: ManagedBatchState = {
    snapshot: {
      taskId,
      direction: input.direction,
      name: input.plan.name,
      sourceLabel: input.plan.sourceLabel,
      targetLabel: input.plan.targetLabel,
      status: 'queued',
      transferredBytes: 0,
      totalBytes,
      speedBytesPerSecond: 0,
      remainingCount
    },
    nodes,
    emitter: event => emitToSender(input.sender, event),
    sourceServerId: input.sourceServerId,
    targetServerId: input.targetServerId,
    roundRobinCursor: 0
  }

  batches.set(taskId, batch)
  batchOrder.push(taskId)
  emitBatch(batch)
  for (const node of nodes.values()) emitNode(batch, node)
  runScheduler()
  return taskId
}

async function refreshFailedSourceMetadata(
  batch: ManagedBatchState,
  node: ManagedNodeState
): Promise<void> {
  const multiplier = batch.snapshot.direction === 'server-transfer' ? 2 : 1
  let size = 0
  let modifyTime: number | undefined

  if (batch.snapshot.direction === 'upload') {
    const sourceStat = await lstat(node.sourcePath)
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error('传输源文件不存在或类型已变化')
    }
    size = sourceStat.size
    modifyTime = sourceStat.mtimeMs
  } else {
    const serverId = batch.sourceServerId
    if (!serverId) throw new Error('源服务器不存在')
    const lease = await acquireSftpConnection(serverId, `${node.id}-retry`)
    try {
      const sourceStat = await lstatRemotePath(lease.client, node.sourcePath)
      if (sourceStat.isSymbolicLink) throw new Error('暂不支持符号链接')
      if (!sourceStat.isFile) throw new Error('传输源文件不存在或类型已变化')
      size = sourceStat.size
      modifyTime = sourceStat.modifyTime
    } finally {
      await lease.release()
    }
  }

  const nextTotal = size * multiplier
  const totalDelta = nextTotal - node.totalBytes
  applyProgressDelta(batch, node, 0, 0)
  node.totalBytes = nextTotal
  node.sourceModifyTime = modifyTime
  batch.snapshot.totalBytes += totalDelta
  for (const ancestor of getAncestors(batch, node)) ancestor.totalBytes += totalDelta

  if (batch.snapshot.direction === 'download') {
    await rm(getTransferTempPath(node.targetPath), { force: true }).catch(() => undefined)
  } else {
    await cleanupNodeArtifacts(batch, node)
  }
}

async function applyActionToNodes(
  batch: ManagedBatchState,
  nodes: ManagedNodeState[],
  action: SftpManagedTaskControlInput['action']
): Promise<void> {
  const targets = new Set<ManagedNodeState>()
  for (const node of nodes) {
    for (const descendant of getDescendants(batch, node.id)) {
      if (descendant.workItem) targets.add(descendant)
    }
  }

  if (action === 'delete') {
    for (const node of nodes) {
      if (batch.nodes.has(node.id)) deleteNode(batch, node)
    }
    runScheduler()
    return
  }

  for (const node of targets) {
    if (action === 'pause' && ['queued', 'transferring'].includes(node.status)) {
      node.status = 'paused'
      if (node.control) node.control.paused = true
    } else if (action === 'resume' && node.status === 'paused') {
      node.status = 'queued'
      node.error = undefined
    } else if (action === 'retry' && node.status === 'failed') {
      try {
        if (node.type === 'file') await refreshFailedSourceMetadata(batch, node)
        node.status = 'queued'
        node.error = undefined
      } catch (error) {
        node.error = error instanceof Error ? error.message : String(error)
      }
    } else {
      continue
    }
    emitNode(batch, node)
    refreshContainers(batch, node)
  }

  runScheduler()
}

export async function controlManagedTransferTask(
  input: SftpManagedTaskControlInput
): Promise<boolean> {
  const batch = batches.get(input.taskId)
  if (!batch) return false

  const nodes = input.nodeIds?.length
    ? input.nodeIds.map(nodeId => batch.nodes.get(nodeId)).filter(Boolean) as ManagedNodeState[]
    : [...batch.nodes.values()].filter(node => !node.parentId)

  await applyActionToNodes(batch, nodes, input.action)
  return true
}

export function getManagedTransferSnapshot(): SftpManagedTaskSnapshot {
  return {
    batches: [...batches.values()].map(batch => ({ ...batch.snapshot })),
    nodes: [...batches.values()].flatMap(batch =>
      [...batch.nodes.values()].filter(node => !node.deleted).map(getNodeSnapshot)
    )
  }
}

export function hasManagedTransferTasks(): boolean {
  return batches.size > 0
}

export async function discardAllManagedTransferTasks(): Promise<void> {
  for (const batch of [...batches.values()]) {
    const roots = [...batch.nodes.values()].filter(node => !node.parentId)
    for (const root of roots) {
      if (batch.nodes.has(root.id)) deleteNode(batch, root)
    }
  }

  await cleanupManagedTransferTempFiles()
}

/** 启动与退出时清除不恢复的中转文件。 */
export async function cleanupManagedTransferTempFiles(): Promise<void> {
  await rm(getRelayTempRoot(), { recursive: true, force: true }).catch(() => undefined)
}

export function setManagedTransferConcurrency(value: number): void {
  maxWorkers = Number.isFinite(value)
    ? Math.min(
        Math.max(Math.trunc(value), SFTP_TRANSFER_CONCURRENCY_MIN),
        SFTP_TRANSFER_CONCURRENCY_MAX
      )
    : appConfig.sftp.transfer.maxConcurrentTasks
  runScheduler()
}
