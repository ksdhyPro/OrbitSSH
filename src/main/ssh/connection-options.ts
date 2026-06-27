import { getSettings } from '../storage/settings-store.js'

export function getSshKeepaliveIntervalMs(): number {
  return getSettings().connection.keepaliveIntervalSeconds * 1000
}

export function getIdleDisconnectMs(): number {
  return getSettings().connection.idleDisconnectMinutes * 60_000
}
