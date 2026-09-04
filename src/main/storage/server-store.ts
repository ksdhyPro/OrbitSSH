import { safeStorage } from 'electron'
import Store from 'electron-store'
import { readFileSync } from 'node:fs'

import type { ServerAppearanceInput, ServerAuthConfig, ServerAuthType, ServerAutomationTask, ServerAutomationTaskInput, ServerConfig, ServerGroup, ServerGroupInput, ServerGroupUpdateInput, ServerInput, ServerPinInput, ServerUpdateInput } from '../../shared/server.js'
import type { PortForwardRule, PortForwardRuleInput, PortForwardRuleUpdateInput } from '../../shared/port-forward.js'

interface ServerStoreSchema {
  servers: ServerConfig[]
  groups: ServerGroup[]
  passwords: Record<string, string>
  automationTasks: Record<string, ServerAutomationTask[]>
  portForwardRules: Record<string, PortForwardRule[]>
}

const store = new Store<ServerStoreSchema>({
  name: 'servers',
  defaults: {
    servers: [],
    groups: [],
    passwords: {},
    automationTasks: {},
    portForwardRules: {}
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

function getGroups(): ServerGroup[] {
  return store.get('groups', [])
}

function saveGroups(groups: ServerGroup[]): void {
  store.set('groups', groups)
}

// 颜色只接受 HTML 色板输出的十六进制值，避免把非法 CSS 写入列表样式。
function normalizeColor(color: unknown): string | undefined {
  if (color === undefined || color === null || color === '') return undefined
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error('颜色格式无效')
  }
  return color.toLowerCase()
}

function normalizeGroupInput(input: ServerGroupInput): ServerGroupInput {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('请填写分组名称')
  if (name.length > 100) throw new Error('分组名称不能超过 100 个字符')
  return { name, color: normalizeColor(input.color) }
}

function getAutomationTasks(): Record<string, ServerAutomationTask[]> {
  return store.get('automationTasks', {})
}

function saveAutomationTasks(tasks: Record<string, ServerAutomationTask[]>): void {
  store.set('automationTasks', tasks)
}

function getPortForwardRules(): Record<string, PortForwardRule[]> {
  return store.get('portForwardRules', {})
}

function savePortForwardRules(rules: Record<string, PortForwardRule[]>): void {
  store.set('portForwardRules', rules)
}

/** 统一校验端口转发规则，避免不安全或不可执行的监听参数进入存储。 */
function normalizePortForwardInput(input: PortForwardRuleInput): PortForwardRuleInput {
  const serverId = typeof input.serverId === 'string' ? input.serverId.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const targetHost = typeof input.targetHost === 'string' ? input.targetHost.trim() : ''
  const listenPort = Number(input.listenPort)
  const targetPort = Number(input.targetPort)
  const direction = input.direction === 'remote' ? 'remote' : 'local'
  const listenScope = input.listenScope === 'lan' ? 'lan' : 'loopback'

  if (!serverId || !getServers().some(server => server.id === serverId)) throw new Error('服务器不存在')
  if (!name || name.length > 100) throw new Error('规则名称不能为空且不能超过 100 个字符')
  if (!targetHost || targetHost.includes('\0')) throw new Error('目标主机无效')
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new Error('监听端口需要在 1 到 65535 之间')
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('目标端口需要在 1 到 65535 之间')

  return { serverId, name, direction, listenScope, listenPort, targetHost, targetPort }
}

export function listPortForwardRules(serverId: string): PortForwardRule[] {
  if (typeof serverId !== 'string' || !serverId.trim()) throw new Error('服务器 ID 无效')
  return [...(getPortForwardRules()[serverId] ?? [])]
}

export function getPortForwardRule(ruleId: string): PortForwardRule {
  for (const rules of Object.values(getPortForwardRules())) {
    const rule = rules.find(item => item.id === ruleId)
    if (rule) return rule
  }
  throw new Error('端口转发规则不存在')
}

export function createPortForwardRule(input: PortForwardRuleInput): PortForwardRule {
  const normalized = normalizePortForwardInput(input)
  const now = Date.now()
  const rule: PortForwardRule = { id: crypto.randomUUID(), ...normalized, createdAt: now, updatedAt: now }
  const rules = getPortForwardRules()
  rules[rule.serverId] = [...(rules[rule.serverId] ?? []), rule]
  savePortForwardRules(rules)
  return rule
}

export function updatePortForwardRule(input: PortForwardRuleUpdateInput): PortForwardRule {
  if (typeof input.id !== 'string' || !input.id.trim()) throw new Error('规则 ID 无效')
  const normalized = normalizePortForwardInput(input)
  const rules = getPortForwardRules()
  const current = getPortForwardRule(input.id)
  const updated = { ...current, ...normalized, updatedAt: Date.now() }
  // 编辑时允许切换服务器，因此需要从旧服务器的规则集合迁移到新集合。
  rules[current.serverId] = (rules[current.serverId] ?? []).filter(rule => rule.id !== input.id)
  rules[updated.serverId] = [...(rules[updated.serverId] ?? []), updated]
  savePortForwardRules(rules)
  return updated
}

export function deletePortForwardRule(ruleId: string): void {
  const rule = getPortForwardRule(ruleId)
  const rules = getPortForwardRules()
  rules[rule.serverId] = (rules[rule.serverId] ?? []).filter(item => item.id !== ruleId)
  savePortForwardRules(rules)
}

export function listServers(): ServerConfig[] {
  // 已置顶的服务器始终显示在列表前方，其余项目保持原有顺序。
  return getServers().sort((left, right) => Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned)))
}

export function listServerGroups(): ServerGroup[] {
  return [...getGroups()]
}

export function createServerGroup(input: ServerGroupInput): ServerGroup {
  const normalizedInput = normalizeGroupInput(input)
  const now = Date.now()
  const group: ServerGroup = { id: crypto.randomUUID(), ...normalizedInput, createdAt: now, updatedAt: now }
  saveGroups([...getGroups(), group])
  return group
}

export function updateServerGroup(input: ServerGroupUpdateInput): ServerGroup {
  if (typeof input.id !== 'string' || !input.id.trim()) throw new Error('分组 ID 无效')
  const normalizedInput = normalizeGroupInput(input)
  const groups = getGroups()
  const index = groups.findIndex(group => group.id === input.id)
  if (index === -1) throw new Error('分组不存在')
  const group: ServerGroup = { ...groups[index], ...normalizedInput, updatedAt: Date.now() }
  groups[index] = group
  saveGroups(groups)
  return group
}

export function deleteServerGroup(groupId: string): void {
  if (typeof groupId !== 'string' || !groupId.trim()) throw new Error('分组 ID 无效')
  if (!getGroups().some(group => group.id === groupId)) return

  saveGroups(getGroups().filter(group => group.id !== groupId))
  // 删除分组时保留连接，并将其恢复为未分组状态。
  saveServers(getServers().map(server => server.groupId === groupId
    ? { ...server, groupId: undefined, updatedAt: Date.now() }
    : server))
}

// 常用命令按 serverId 分区保存，保证不同服务器间不会相互混用。
export function listServerAutomationTasks(serverId: string): ServerAutomationTask[] {
  if (typeof serverId !== 'string' || !serverId.trim()) {
    throw new Error('服务器 ID 无效')
  }

  return [...(getAutomationTasks()[serverId] ?? [])]
}

export function getServerAutomationTask(taskId: string): ServerAutomationTask {
  const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : ''

  for (const tasks of Object.values(getAutomationTasks())) {
    const task = tasks.find(item => item.id === normalizedTaskId)
    if (task) return task
  }

  throw new Error('自动化任务不存在')
}

export function createServerAutomationTask(input: ServerAutomationTaskInput): ServerAutomationTask {
  const serverId = typeof input.serverId === 'string' ? input.serverId.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const script = typeof input.script === 'string' ? input.script.trim() : ''

  if (!serverId) {
    throw new Error('服务器 ID 无效')
  }

  if (!name || !script) {
    throw new Error('请填写命令名称和命令内容')
  }

  if (name.length > 100) {
    throw new Error('命令名称不能超过 100 个字符')
  }

  if (script.length > 20_000) {
    throw new Error('命令内容不能超过 4000 个字符')
  }

  const now = Date.now()
  const task: ServerAutomationTask = {
    id: crypto.randomUUID(),
    serverId,
    name,
    script,
    createdAt: now,
    updatedAt: now
  }
  const tasks = getAutomationTasks()
  tasks[serverId] = [...(tasks[serverId] ?? []), task]
  saveAutomationTasks(tasks)

  return task
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
    isPinned: false,
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

  // 删除服务器时同步清理其专属常用命令，避免本地配置残留。
  const tasks = getAutomationTasks()
  delete tasks[serverId]
  saveAutomationTasks(tasks)

  const portForwardRules = getPortForwardRules()
  delete portForwardRules[serverId]
  savePortForwardRules(portForwardRules)
}

// 更新置顶状态时只改动目标服务器，避免影响已保存的连接认证信息。
export function setServerPinned(input: ServerPinInput): ServerConfig {
  if (typeof input.id !== 'string' || !input.id.trim() || typeof input.isPinned !== 'boolean') {
    throw new Error('服务器置顶参数无效')
  }

  const servers = getServers()
  const serverIndex = servers.findIndex((server) => server.id === input.id)

  if (serverIndex === -1) {
    throw new Error('服务器不存在')
  }

  const updatedServer: ServerConfig = {
    ...servers[serverIndex],
    isPinned: input.isPinned,
    updatedAt: Date.now()
  }

  servers[serverIndex] = updatedServer
  saveServers(servers)

  return updatedServer
}

export function updateServerAppearance(input: ServerAppearanceInput): ServerConfig {
  if (typeof input.id !== 'string' || !input.id.trim()) throw new Error('服务器 ID 无效')
  const groupId = typeof input.groupId === 'string' && input.groupId.trim() ? input.groupId.trim() : undefined
  if (groupId && !getGroups().some(group => group.id === groupId)) throw new Error('目标分组不存在')

  const servers = getServers()
  const index = servers.findIndex(server => server.id === input.id)
  if (index === -1) throw new Error('服务器不存在')
  const server: ServerConfig = { ...servers[index], groupId, color: normalizeColor(input.color), updatedAt: Date.now() }
  servers[index] = server
  saveServers(servers)
  return server
}
