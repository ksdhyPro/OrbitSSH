import SftpClient from 'ssh2-sftp-client'

import { writeAppLog } from '../logger.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import type { RemoteFileNode, SftpInitResult } from '../../shared/sftp.js'

interface SftpSession {
  tabId: string
  serverId: string
  client: SftpClient
  homePath: string
}

const sftpSessions = new Map<string, SftpSession>()

function normalizeRemotePath(path: string): string {
  const trimmedPath = path.trim()

  if (!trimmedPath) {
    return '.'
  }

  return trimmedPath.replace(/\/+/g, '/')
}

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

// 为终端 Tab 创建独立 SFTP 会话，默认读取远程 home 目录。
export async function openSftpSession(tabId: string, serverId: string): Promise<SftpInitResult> {
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
  const client = new SftpClient(`sftp-${tabId}`)

  try {
    await client.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password,
      readyTimeout: 15000
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

  const homePath = normalizeRemotePath(await client.cwd())
  const session: SftpSession = {
    tabId,
    serverId,
    client,
    homePath
  }

  sftpSessions.set(tabId, session)
  writeAppLog({
    scope: 'main.sftp',
    message: 'SFTP 会话创建成功',
    data: { tabId, serverId, homePath }
  })

  const nodes = await listRemoteDirectory(tabId, homePath)
  writeAppLog({
    scope: 'main.sftp',
    message: 'home 目录读取完成',
    data: { tabId, path: homePath, nodeCount: nodes.length }
  })

  return {
    homePath,
    nodes
  }
}

export async function listRemoteDirectory(tabId: string, path: string): Promise<RemoteFileNode[]> {
  const session = sftpSessions.get(tabId)

  if (!session) {
    throw new Error('SFTP 会话不存在')
  }

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
