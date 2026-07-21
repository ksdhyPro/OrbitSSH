import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const connectionOptionsUrl = new URL(
  '../../src/main/ssh/connection-options.ts',
  import.meta.url,
)
const settingsStoreUrl = new URL(
  '../../src/main/storage/settings-store.ts',
  import.meta.url,
)
const sharedSettingsUrl = new URL(
  '../../src/shared/settings.ts',
  import.meta.url,
)

test('SSH 每 30 秒发送协议级保活且允许连续三次失败', async () => {
  const [connectionOptions, sharedSettings] = await Promise.all([
    readFile(connectionOptionsUrl, 'utf8'),
    readFile(sharedSettingsUrl, 'utf8'),
  ])

  assert.match(sharedSettings, /keepaliveIntervalSeconds:\s*30/)
  assert.match(connectionOptions, /keepaliveInterval:\s*getSshKeepaliveIntervalMs\(\)/)
  assert.match(connectionOptions, /const sshKeepaliveCountMax = 3/)
})

test('旧版 10 秒保活和 5 分钟空闲断开默认值会一次性迁移', async () => {
  const settingsStore = await readFile(settingsStoreUrl, 'utf8')

  assert.match(settingsStore, /keepaliveIntervalSeconds:\s*10/)
  assert.match(settingsStore, /idleDisconnectMinutes:\s*5/)
  assert.match(settingsStore, /function migrateLegacyConnectionDefaults\(\)/)
  assert.match(settingsStore, /\.\.\.defaultAppSettings\.connection/)
  assert.match(
    settingsStore,
    /migrateLegacyConnectionDefaults\(\)\s*\n\s*const rawSettings[\s\S]*const normalizedSettings = normalizeSettings\(rawSettings\)/,
  )
})
