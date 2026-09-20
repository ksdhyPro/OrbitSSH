import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [dialogSource, settingsStoreSource, sharedSource, mainSettingsSource] = await Promise.all([
  readFile(new URL('../../src/renderer/components/SettingsDialog.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../src/renderer/stores/useSettingsStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/shared/settings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/main/storage/settings-store.ts', import.meta.url), 'utf8')
])

test('MCP 访问开关位于 AI 设置并默认关闭', () => {
  assert.match(dialogSource, /允许第三方 AI 通过 MCP 访问/)
  assert.match(dialogSource, /appSettings\.ai\.allowMcpAccess/)
  assert.match(dialogSource, /'updateAiSetting',\s*'allowMcpAccess'/)
  assert.match(sharedSource, /allowMcpAccess:\s*false/)
  assert.match(
    settingsStoreSource,
    /allowMcpAccess:\s*value\.allowMcpAccess/
  )
  assert.match(
    mainSettingsSource,
    /allowMcpAccess:\s*value\?\.allowMcpAccess === true/
  )
})
