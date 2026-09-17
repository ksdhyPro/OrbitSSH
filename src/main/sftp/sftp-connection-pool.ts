import SftpClient from 'ssh2-sftp-client'

import { writeAppLog } from '../logger.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'
import { getSshKeepaliveIntervalMs } from '../ssh/connection-options.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { appConfig } from '../../shared/config.js'
import {
  SFTP_TRANSFER_CONCURRENCY_MAX,
  SFTP_TRANSFER_CONCURRENCY_MIN
} from '../../shared/settings.js'

interface PooledConnection {
  client: SftpClient
  serverId: string
  borrowed: boolean
  stale: boolean
  idleTimer?: NodeJS.Timeout
}

interface PoolWaiter {
  label: string
  resolve: (lease: SftpConnectionLease) => void
  reject: (error: unknown) => void
}

export interface SftpConnectionLease {
  client: SftpClient
  serverId: string
  release: (reusable?: boolean) => Promise<void>
}

const IDLE_TIMEOUT_MS = 60_000
const connectionsByServer = new Map<string, PooledConnection[]>()
const waitersByServer = new Map<string, PoolWaiter[]>()
const creatingByServer = new Map<string, number>()
let maxConnectionsPerServer: number = appConfig.sftp.transfer.maxConcurrentTasks * 2

function normalizeLimit(value: number): number {
  return Number.isFinite(value)
    ? Math.min(
        Math.max(Math.trunc(value), SFTP_TRANSFER_CONCURRENCY_MIN),
        SFTP_TRANSFER_CONCURRENCY_MAX
      )
    : appConfig.sftp.transfer.maxConcurrentTasks
}

function getServerConnections(serverId: string): PooledConnection[] {
  const existing = connectionsByServer.get(serverId)

  if (existing) return existing

  const created: PooledConnection[] = []
  connectionsByServer.set(serverId, created)
  return created
}

async function closeConnection(connection: PooledConnection): Promise<void> {
  connection.stale = true
  if (connection.idleTimer) clearTimeout(connection.idleTimer)

  const serverConnections = connectionsByServer.get(connection.serverId)
  const index = serverConnections?.indexOf(connection) ?? -1
  if (index >= 0) serverConnections?.splice(index, 1)
  if (serverConnections?.length === 0) connectionsByServer.delete(connection.serverId)

  await connection.client.end().catch((error) => {
    writeAppLog({
      scope: 'main.sftp.pool',
      level: 'warn',
      message: '关闭传输连接失败',
      data: {
        serverId: connection.serverId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  })
}

function createLease(connection: PooledConnection): SftpConnectionLease {
  let released = false

  return {
    client: connection.client,
    serverId: connection.serverId,
    release: async (reusable = true) => {
      if (released) return
      released = true
      connection.borrowed = false

      if (!reusable || connection.stale) {
        await closeConnection(connection)
      } else {
        connection.idleTimer = setTimeout(() => {
          if (!connection.borrowed) void closeConnection(connection)
        }, IDLE_TIMEOUT_MS)
      }

      void dispatchWaiters(connection.serverId)
    }
  }
}

async function createConnection(serverId: string, label: string): Promise<PooledConnection> {
  const server = getServerAuthConfig(serverId)
  const client = new SftpClient(`pool-${serverId}-${label}`)

  await client.connect({
    ...createServerConnectOptions(server),
    readyTimeout: 15000,
    keepaliveInterval: getSshKeepaliveIntervalMs()
  })

  const connection: PooledConnection = {
    client,
    serverId,
    borrowed: true,
    stale: false
  }
  getServerConnections(serverId).push(connection)
  return connection
}

async function tryAcquire(serverId: string, label: string): Promise<SftpConnectionLease | null> {
  const connections = getServerConnections(serverId)
  const idleConnection = connections.find(connection => !connection.borrowed && !connection.stale)

  if (idleConnection) {
    if (idleConnection.idleTimer) clearTimeout(idleConnection.idleTimer)
    idleConnection.borrowed = true
    return createLease(idleConnection)
  }

  const creatingCount = creatingByServer.get(serverId) ?? 0
  if (connections.length + creatingCount >= maxConnectionsPerServer) return null

  creatingByServer.set(serverId, creatingCount + 1)
  try {
    return createLease(await createConnection(serverId, label))
  } finally {
    const nextCount = Math.max((creatingByServer.get(serverId) ?? 1) - 1, 0)
    if (nextCount === 0) creatingByServer.delete(serverId)
    else creatingByServer.set(serverId, nextCount)
  }
}

async function dispatchWaiters(serverId: string): Promise<void> {
  const waiters = waitersByServer.get(serverId)
  if (!waiters?.length) return

  const waiter = waiters[0]

  try {
    const lease = await tryAcquire(serverId, waiter.label)
    if (!lease) return
    waiters.shift()
    waiter.resolve(lease)
  } catch (error) {
    waiters.shift()
    waiter.reject(error)
  }

  if (waiters.length === 0) waitersByServer.delete(serverId)
  else void dispatchWaiters(serverId)
}

/** 独占租用连接；同一连接不会同时交给多个传输文件。 */
export async function acquireSftpConnection(
  serverId: string,
  label: string
): Promise<SftpConnectionLease> {
  const lease = await tryAcquire(serverId, label)
  if (lease) return lease

  return new Promise<SftpConnectionLease>((resolve, reject) => {
    const waiters = waitersByServer.get(serverId) ?? []
    waiters.push({ label, resolve, reject })
    waitersByServer.set(serverId, waiters)
  })
}

export function setSftpConnectionPoolLimit(value: number): void {
  // 同一服务器内中转也需要同时租用源、目标连接，因此连接上限为文件并发数的两倍。
  maxConnectionsPerServer = normalizeLimit(value) * 2

  for (const serverId of waitersByServer.keys()) {
    void dispatchWaiters(serverId)
  }
}

export async function invalidateServerConnections(serverId: string): Promise<void> {
  const connections = [...getServerConnections(serverId)]
  await Promise.all(connections.map(connection => closeConnection(connection)))
}

export async function closeAllSftpTransferConnections(): Promise<void> {
  const connections = [...connectionsByServer.values()].flat()
  connectionsByServer.clear()
  waitersByServer.clear()
  creatingByServer.clear()
  await Promise.all(connections.map(connection => closeConnection(connection)))
}
