import type { ConnectConfig } from 'ssh2'

import { getSettings } from '../storage/settings-store.js'

const sshReadyTimeoutMs = 15_000
const sshKeepaliveCountMax = 3

export function getSshKeepaliveIntervalMs(): number {
  return getSettings().connection.keepaliveIntervalSeconds * 1000
}

/**
 * Options shared by every SSH transport. ssh2 sends protocol-level keepalive
 * requests when the connection is idle and closes it after repeated failures.
 */
export function getSshConnectionOptions(): Pick<
  ConnectConfig,
  'readyTimeout' | 'keepaliveInterval' | 'keepaliveCountMax'
> {
  return {
    readyTimeout: sshReadyTimeoutMs,
    keepaliveInterval: getSshKeepaliveIntervalMs(),
    keepaliveCountMax: sshKeepaliveCountMax
  }
}

export function getIdleDisconnectMs(): number {
  return getSettings().connection.idleDisconnectMinutes * 60_000
}
