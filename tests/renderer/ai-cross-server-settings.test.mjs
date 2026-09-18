import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsDialogUrl = new URL(
  '../../src/renderer/components/SettingsDialog.vue',
  import.meta.url,
)
const settingsStoreUrl = new URL(
  '../../src/renderer/stores/useSettingsStore.ts',
  import.meta.url,
)
const sharedSettingsUrl = new URL('../../src/shared/settings.ts', import.meta.url)
const agentActionsUrl = new URL(
  '../../src/main/ai/ai-agent-actions.ts',
  import.meta.url,
)
const permissionPolicyUrl = new URL(
  '../../src/main/ai/ai-permission-policy.ts',
  import.meta.url,
)

test('AI 设置提供跨服务器操作开关并明确提示逐次确认', async () => {
  const source = await readFile(settingsDialogUrl, 'utf8')

  assert.match(source, /是否允许跨服务器执行操作/)
  assert.match(source, /appSettings\.ai\.allowCrossServerOperations/)
  assert.match(source, /'updateAiSetting',\s*'allowCrossServerOperations'/)
  assert.match(source, /每次跨服务器命令仍需单独确认/)
})

test('开关关闭时对话会明确提示用户前往全局 AI 设置开启', async () => {
  const [actionsSource, policySource] = await Promise.all([
    readFile(agentActionsUrl, 'utf8'),
    readFile(permissionPolicyUrl, 'utf8'),
  ])

  assert.match(actionsSource, /CROSS_SERVER_OPERATIONS_DISABLED_MESSAGE/)
  assert.match(policySource, /已阻止跨服务器操作/)
  assert.match(policySource, /AI → 是否允许跨服务器执行操作/)
  assert.match(policySource, /每次跨服务器命令仍需单独确认/)
})

test('跨服务器操作默认关闭并包含在设置保存数据中', async () => {
  const [sharedSource, storeSource] = await Promise.all([
    readFile(sharedSettingsUrl, 'utf8'),
    readFile(settingsStoreUrl, 'utf8'),
  ])

  assert.match(sharedSource, /allowCrossServerOperations:\s*false/)
  assert.match(
    storeSource,
    /allowCrossServerOperations:\s*appSettings\.ai\.allowCrossServerOperations/,
  )
  assert.match(
    storeSource,
    /allowCrossServerOperations:\s*value\.allowCrossServerOperations/,
  )
})
