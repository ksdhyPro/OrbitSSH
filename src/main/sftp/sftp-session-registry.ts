import type SftpClient from 'ssh2-sftp-client'
import type { WebContents } from 'electron'

export interface SftpSession {
  tabId: string
  serverId: string
  webContents: WebContents
  client: SftpClient
  homePath: string
  lastActiveAt: number
}

const sftpSessions = new Map<string, SftpSession>()

export function getSftpSession(tabId: string): SftpSession {
  const session = sftpSessions.get(tabId)

  if (!session) {
    throw new Error('SFTP 会话不存在')
  }

  session.lastActiveAt = Date.now()
  return session
}

export function findSftpSession(tabId: string): SftpSession | undefined {
  return sftpSessions.get(tabId)
}

export function hasSftpSession(tabId: string): boolean {
  return sftpSessions.has(tabId)
}

export function setSftpSession(tabId: string, session: SftpSession): void {
  sftpSessions.set(tabId, session)
}

export function deleteSftpSession(tabId: string): void {
  sftpSessions.delete(tabId)
}

export function listSftpSessions(): SftpSession[] {
  return [...sftpSessions.values()]
}
