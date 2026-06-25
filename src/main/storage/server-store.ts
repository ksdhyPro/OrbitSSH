import { safeStorage } from 'electron'
import Store from 'electron-store'
import { readFileSync } from 'node:fs'

import type { ServerAuthConfig, ServerAuthType, ServerConfig, ServerInput, ServerUpdateInput } from '../../shared/server.js'

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
  const authType: ServerAuthType = input.authType === 'privateKey' ? 'privateKey' : 'password'
  const password = typeof input.password === 'string' ? input.password : ''
  const privateKeyPath = typeof input.privateKeyPath === 'string' ? input.privateKeyPath.trim() : ''
  const passphrase = typeof input.passphrase === 'string' ? input.passphrase : ''
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
    authType,
    password,
    privateKeyPath,
    passphrase,
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

// 连接前再读取密钥文件，列表配置只保存路径，避免把私钥内容写入本地配置。
function readPrivateKeyFile(privateKeyPath: string): string {
  try {
    return readFileSync(privateKeyPath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`密钥文件读取失败：${message}`)
  }
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

export function getServerAuthConfig(serverId: string): ServerAuthConfig {
  const server = getServers().find((item) => item.id === serverId)

  if (!server) {
    throw new Error('服务器不存在')
  }

  if (server.authType === 'privateKey') {
    if (!server.privateKeyPath) {
      throw new Error('服务器密钥文件路径不存在')
    }

    const passwords = getPasswords()
    const encryptedPassphrase = server.passphraseKey ? passwords[server.passphraseKey] : undefined

    return {
      ...server,
      authType: 'privateKey',
      privateKey: readPrivateKeyFile(server.privateKeyPath),
      passphrase: typeof encryptedPassphrase === 'string' ? decryptPassword(encryptedPassphrase) : undefined
    }
  }

  if (!server.passwordKey) {
    throw new Error('服务器密码索引不存在')
  }

  const encryptedPassword = getPasswords()[server.passwordKey]

  if (typeof encryptedPassword !== 'string') {
    throw new Error('服务器密码不存在')
  }

  return {
    ...server,
    authType: 'password',
    password: decryptPassword(encryptedPassword)
  }
}

export function createServer(input: ServerInput): ServerConfig {
  const normalizedInput = normalizeServerInput(input)

  if (normalizedInput.authType === 'password' && !normalizedInput.password) {
    throw new Error('请填写 Password')
  }

  if (normalizedInput.authType === 'privateKey' && !normalizedInput.privateKeyPath) {
    throw new Error('请填写密钥文件路径')
  }

  const now = Date.now()
  const id = crypto.randomUUID()
  const passwordKey = `server-password-${id}`
  const passphraseKey = `server-passphrase-${id}`
  const server: ServerConfig = {
    id,
    name: normalizedInput.name,
    host: normalizedInput.host,
    port: normalizedInput.port,
    username: normalizedInput.username,
    authType: normalizedInput.authType ?? 'password',
    passwordKey: normalizedInput.authType === 'password' ? passwordKey : undefined,
    privateKeyPath: normalizedInput.authType === 'privateKey' ? normalizedInput.privateKeyPath : undefined,
    passphraseKey:
      normalizedInput.authType === 'privateKey' && normalizedInput.passphrase ? passphraseKey : undefined,
    createdAt: now,
    updatedAt: now
  }

  const servers = getServers()
  const passwords = getPasswords()

  if (normalizedInput.authType === 'privateKey') {
    if (normalizedInput.passphrase) {
      passwords[passphraseKey] = encryptPassword(normalizedInput.passphrase)
    }
  } else {
    passwords[passwordKey] = encryptPassword(normalizedInput.password ?? '')
  }

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
  const passwords = getPasswords()
  const nextAuthType = normalizedInput.authType ?? currentServer.authType
  let updatedServer: ServerConfig = {
    ...currentServer,
    name: normalizedInput.name,
    host: normalizedInput.host,
    port: normalizedInput.port,
    username: normalizedInput.username,
    updatedAt: Date.now()
  }

  if (nextAuthType === 'privateKey') {
    if (!normalizedInput.privateKeyPath) {
      throw new Error('请填写密钥文件路径')
    }

    const nextPassphraseKey =
      currentServer.authType === 'privateKey'
        ? currentServer.passphraseKey ?? (normalizedInput.passphrase ? `server-passphrase-${currentServer.id}` : undefined)
        : normalizedInput.passphrase
          ? `server-passphrase-${currentServer.id}`
          : undefined

    if (currentServer.authType === 'password' && currentServer.passwordKey) {
      delete passwords[currentServer.passwordKey]
    }

    if (normalizedInput.passphrase && nextPassphraseKey) {
      passwords[nextPassphraseKey] = encryptPassword(normalizedInput.passphrase)
    }

    updatedServer = {
      ...updatedServer,
      authType: 'privateKey',
      passwordKey: undefined,
      privateKeyPath: normalizedInput.privateKeyPath,
      passphraseKey: nextPassphraseKey
    }
  } else {
    const nextPasswordKey =
      currentServer.authType === 'password' && currentServer.passwordKey
        ? currentServer.passwordKey
        : `server-password-${currentServer.id}`

    if (currentServer.authType !== 'password' && !normalizedInput.password) {
      throw new Error('请填写 Password')
    }

    if (currentServer.authType === 'privateKey' && currentServer.passphraseKey) {
      delete passwords[currentServer.passphraseKey]
    }

    // 编辑密码连接时留空密码表示不修改已有密码。
    if (normalizedInput.password) {
      passwords[nextPasswordKey] = encryptPassword(normalizedInput.password)
    }

    updatedServer = {
      ...updatedServer,
      authType: 'password',
      passwordKey: nextPasswordKey,
      privateKeyPath: undefined,
      passphraseKey: undefined
    }
  }

  servers[serverIndex] = updatedServer
  savePasswords(passwords)
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

  if (server.passwordKey) {
    delete passwords[server.passwordKey]
  }

  if (server.passphraseKey) {
    delete passwords[server.passphraseKey]
  }

  savePasswords(passwords)
  saveServers(servers.filter((item) => item.id !== serverId))
}
