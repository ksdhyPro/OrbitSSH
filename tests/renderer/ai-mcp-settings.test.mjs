import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [dialogSource, settingsStoreSource, sharedSource, mainSettingsSource, preloadSource, mcpSetupSource] = await Promise.all([
  readFile(new URL('../../src/renderer/components/SettingsDialog.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../src/renderer/stores/useSettingsStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/shared/settings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/main/storage/settings-store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/preload/index.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../../src/main/ipc/mcp-setup-ipc.ts', import.meta.url), 'utf8')
])

test('SSH 与 SFTP MCP 访问开关位于 AI 设置并默认关闭', () => {
  assert.match(dialogSource, /允许第三方 AI 通过 MCP 使用 SSH/)
  assert.match(dialogSource, /允许第三方 AI 通过 MCP 使用 SFTP/)
  assert.match(dialogSource, /appSettings\.ai\.allowMcpAccess/)
  assert.match(dialogSource, /appSettings\.ai\.allowMcpSftpAccess/)
  assert.match(dialogSource, /'updateAiSetting',\s*'allowMcpAccess'/)
  assert.match(dialogSource, /'updateAiSetting',\s*'allowMcpSftpAccess'/)
  assert.match(sharedSource, /allowMcpAccess:\s*false/)
  assert.match(sharedSource, /allowMcpSftpAccess:\s*false/)
  assert.match(
    settingsStoreSource,
    /allowMcpAccess:\s*value\.allowMcpAccess/
  )
  assert.match(
    settingsStoreSource,
    /allowMcpSftpAccess:\s*value\.allowMcpSftpAccess/
  )
  assert.match(
    mainSettingsSource,
    /allowMcpAccess:\s*value\?\.allowMcpAccess === true/
  )
  assert.match(
    mainSettingsSource,
    /allowMcpSftpAccess:\s*value\?\.allowMcpSftpAccess === true/
  )
})

test('AI 设置提供 Agent 安装提示词并使用主程序 MCP 入口', () => {
  assert.match(dialogSource, /如何安装到 Agent？/)
  assert.match(dialogSource, /复制提示词/)
  assert.match(dialogSource, /getMcpInstallInfo/)
  assert.match(dialogSource, /Skill 目录/)
  assert.match(dialogSource, /不得替我开启 OrbitSSH 设置中的 SSH\/SFTP MCP 授权开关/)
  assert.match(preloadSource, /mcp:get-install-info/)
  assert.match(mcpSetupSource, /process\.execPath/)
  assert.match(mcpSetupSource, /'--mcp-stdio'/)
})
