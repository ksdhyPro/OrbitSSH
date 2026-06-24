import { safeStorage } from 'electron'
import Store from 'electron-store'

import type { ServerConfig, ServerInput, ServerUpdateInput } from '../../shared/server.js'

interface ServerStoreSchema {
  servers: ServerConfig[]
  passwords: Record<string, string>
}

const store = new Store<ServerStoreSchema>({
  name: 'servers',
  defaults: {
    servers: [],
    passwords: {}
  }
})

// 统一校验服务器表单输入，避免无效数据进入本地存储。
function normalizeServerInput(input: ServerInput): ServerInput {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const username = typeof input.username === 'string' ? input.username.trim() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const port = Number(input.port)

  if (!name || !host || !username) {
    throw new Error('请填写名称、Host 和 Username')
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port 需要在 1 到 65535 之间')
  }

  return {
    name,
    host,
    username,
    password,
    port
  }
}

// 使用 Electron safeStorage 加密密码，避免明文写入本地配置。
function encryptPassword(password: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统暂不支持安全密码存储')
  }

  return safeStorage.encryptString(password).toString('base64')
}

function decryptPassword(encryptedPassword: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统暂不支持安全密码读取')
  }

  return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'))
}

function getServers(): ServerConfig[] {
  return store.get('servers', [])
}

function getPasswords(): Record<string, string> {
  return store.get('passwords', {})
}

function saveServers(servers: ServerConfig[]): void {
  store.set('servers', servers)
}

function savePasswords(passwords: Record<string, string>): void {
  store.set('passwords', passwords)
}

export function listServers(): ServerConfig[] {
  return getServers()
}

export function getServerAuthConfig(serverId: string): ServerConfig & { password: string } {
  const server = getServers().find((item) => item.id === serverId)

  if (!server) {
    throw new Error('服务器不存在')
  }

  const encryptedPassword = getPasswords()[server.passwordKey]

  if (typeof encryptedPassword !== 'string') {
    throw new Error('服务器密码不存在')
  }

  return {
    ...server,
    password: decryptPassword(encryptedPassword)
  }
}

export function createServer(input: ServerInput): ServerConfig {
  const normalizedInput = normalizeServerInput(input)

  if (!normalizedInput.password) {
    throw new Error('请填写 Password')
  }

  const now = Date.now()
  const id = crypto.randomUUID()
  const passwordKey = `server-password-${id}`
  const server: ServerConfig = {
    id,
    name: normalizedInput.name,
    host: normalizedInput.host,
    port: normalizedInput.port,
    username: normalizedInput.username,
    authType: 'password',
    passwordKey,
    createdAt: now,
    updatedAt: now
  }

  const servers = getServers()
  const passwords = getPasswords()
  passwords[passwordKey] = encryptPassword(normalizedInput.password ?? '')

  savePasswords(passwords)
  saveServers([server, ...servers])

  return server
}

export function updateServer(input: ServerUpdateInput): ServerConfig {
  const normalizedInput = normalizeServerInput(input)
  const servers = getServers()
  const serverIndex = servers.findIndex((server) => server.id === input.id)

  if (serverIndex === -1) {
    throw new Error('服务器不存在')
  }

  const currentServer = servers[serverIndex]
  const updatedServer: ServerConfig = {
    ...currentServer,
    name: normalizedInput.name,
    host: normalizedInput.host,
    port: normalizedInput.port,
    username: normalizedInput.username,
    updatedAt: Date.now()
  }

  servers[serverIndex] = updatedServer

  // 编辑时留空密码表示不修改已有密码。
  if (normalizedInput.password) {
    const passwords = getPasswords()
    passwords[currentServer.passwordKey] = encryptPassword(normalizedInput.password)
    savePasswords(passwords)
  }

  saveServers(servers)

  return updatedServer
}

export function deleteServer(serverId: string): void {
  if (typeof serverId !== 'string' || !serverId.trim()) {
    throw new Error('服务器 ID 无效')
  }

  const servers = getServers()
  const server = servers.find((item) => item.id === serverId)

  if (!server) {
    return
  }

  const passwords = getPasswords()
  delete passwords[server.passwordKey]

  savePasswords(passwords)
  saveServers(servers.filter((item) => item.id !== serverId))
}
