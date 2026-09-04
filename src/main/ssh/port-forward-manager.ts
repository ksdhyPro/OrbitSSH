import net, { type Server, type Socket } from 'node:net'
import { Client, type ClientChannel } from 'ssh2'
import type { WebContents } from 'electron'

import type { PortForwardRule, PortForwardRuntime } from '../../shared/port-forward.js'
import { getServerAuthConfig } from '../storage/server-store.js'
import { createServerConnectOptions } from './auth-options.js'
import { getSshKeepaliveIntervalMs } from './connection-options.js'
import { writeAppLog } from '../logger.js'

interface RunningPortForward {
  rule: PortForwardRule
  owner: WebContents
  client: Client
  /** 实际连接的服务地址：-L 使用当前 SSH 服务器，-R 使用本机回环地址。 */
  targetHost: string
  localServer?: Server
  stopping: boolean
}

const runningForwards = new Map<string, RunningPortForward>()
const runtimes = new Map<string, PortForwardRuntime>()

function listenHost(rule: PortForwardRule): string {
  return rule.listenScope === 'lan' ? '0.0.0.0' : '127.0.0.1'
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '端口转发失败'
}

function publish(owner: WebContents, runtime: PortForwardRuntime): void {
  runtimes.set(runtime.ruleId, runtime)
  if (!owner.isDestroyed()) owner.send('port-forward:status', runtime)
}

function pipeSockets(left: Socket | ClientChannel, right: Socket | ClientChannel): void {
  left.on('error', () => right.destroy())
  right.on('error', () => left.destroy())
  left.pipe(right).pipe(left)
}

function stopRunning(forward: RunningPortForward, status: PortForwardRuntime['status'], message?: string): void {
  if (forward.stopping) return
  forward.stopping = true
  runningForwards.delete(forward.rule.id)

  if (forward.localServer) forward.localServer.close()
  if (forward.rule.direction === 'remote') {
    forward.client.unforwardIn(listenHost(forward.rule), forward.rule.listenPort, () => undefined)
  }
  forward.client.end()
  publish(forward.owner, { ruleId: forward.rule.id, serverId: forward.rule.serverId, status, message })
}

function fail(forward: RunningPortForward, error: unknown): void {
  const message = safeError(error)
  writeAppLog({
    scope: 'main.port-forward',
    level: 'warn',
    message: '端口转发失败',
    data: { ruleId: forward.rule.id, serverId: forward.rule.serverId, error: message },
  })
  stopRunning(forward, 'error', message)
}

function startLocalForward(forward: RunningPortForward): void {
  const rule = forward.rule
  const server = net.createServer(socket => {
    forward.client.forwardOut(
      socket.remoteAddress || '127.0.0.1',
      socket.remotePort || 0,
      forward.targetHost,
      rule.targetPort,
      (error, channel) => {
        if (error || !channel) {
          const message = safeError(error || new Error('无法建立远端转发通道'))
          writeAppLog({ scope: 'main.port-forward', level: 'warn', message: '本地转发目标连接失败', data: { ruleId: rule.id, targetHost: forward.targetHost, targetPort: rule.targetPort, error: message } })
          socket.destroy(error || new Error('无法建立远端转发通道'))
          return
        }
        pipeSockets(socket, channel)
      },
    )
  })
  forward.localServer = server
  server.once('error', error => fail(forward, error))
  server.listen({ host: listenHost(rule), port: rule.listenPort }, () => {
    if (!forward.stopping) {
      publish(forward.owner, { ruleId: rule.id, serverId: rule.serverId, status: 'running' })
    }
  })
}

function startRemoteForward(forward: RunningPortForward): void {
  const rule = forward.rule
  forward.client.on('tcp connection', (_details, accept, reject) => {
    const socket = net.connect({ host: rule.targetHost, port: rule.targetPort })
    socket.once('error', error => {
      reject()
      writeAppLog({ scope: 'main.port-forward', level: 'warn', message: '远程转发目标连接失败', data: { ruleId: rule.id, error: safeError(error) } })
    })
    socket.once('connect', () => {
      const channel = accept()
      if (channel) pipeSockets(socket, channel)
      else socket.destroy()
    })
  })
  forward.client.forwardIn(listenHost(rule), rule.listenPort, error => {
    if (error) {
      fail(forward, error)
      return
    }
    if (!forward.stopping) {
      publish(forward.owner, { ruleId: rule.id, serverId: rule.serverId, status: 'running' })
    }
  })
}

/** 启动独立 SSH 后台连接，避免端口转发受终端标签生命周期影响。 */
export function startPortForward(owner: WebContents, rule: PortForwardRule): void {
  if (runningForwards.has(rule.id)) throw new Error('端口转发已在运行')

  const server = getServerAuthConfig(rule.serverId)
  const client = new Client()
  // -L 的目标就是当前 SSH 服务器；-R 的目标是运行 OrbitSSH 的本机服务。
  const targetHost = rule.direction === 'local' ? server.host : '127.0.0.1'
  const forward: RunningPortForward = { rule, owner, client, targetHost, stopping: false }
  runningForwards.set(rule.id, forward)
  publish(owner, { ruleId: rule.id, serverId: rule.serverId, status: 'starting' })

  client
    .once('ready', () => {
      if (rule.direction === 'local') startLocalForward(forward)
      else startRemoteForward(forward)
    })
    .once('error', error => {
      if (!forward.stopping) fail(forward, error)
    })
    .once('close', () => {
      if (!forward.stopping && runningForwards.has(rule.id)) {
        fail(forward, new Error('SSH 连接已断开'))
      }
    })

  try {
    client.connect({ ...createServerConnectOptions(server), readyTimeout: 15_000, keepaliveInterval: getSshKeepaliveIntervalMs() })
  } catch (error) {
    fail(forward, error)
  }
}

export function stopPortForward(ruleId: string): boolean {
  const forward = runningForwards.get(ruleId)
  if (!forward) return false
  stopRunning(forward, 'stopped')
  return true
}

export function getPortForwardRuntimes(serverId: string): PortForwardRuntime[] {
  return [...runtimes.values()].filter(runtime => runtime.serverId === serverId)
}

export function isPortForwardRunning(ruleId: string): boolean {
  return runningForwards.has(ruleId)
}

export function closeAllPortForwards(): void {
  for (const forward of [...runningForwards.values()]) stopRunning(forward, 'stopped')
}
