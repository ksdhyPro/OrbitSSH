import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsUrl = new URL('../../src/shared/settings.ts', import.meta.url)
const agentUrl = new URL('../../src/main/ai/ai-agent.ts', import.meta.url)
const dialogUrl = new URL(
  '../../src/renderer/components/SettingsDialog.vue',
  import.meta.url,
)

test('命令批准默认不过期且可按分钟配置', async () => {
  const [settings, agent, dialog] = await Promise.all([
    readFile(settingsUrl, 'utf8'),
    readFile(agentUrl, 'utf8'),
    readFile(dialogUrl, 'utf8'),
  ])

  assert.match(settings, /commandApprovalTimeoutMinutes:\s*0/)
  assert.match(
    agent,
    /settings\.ai\.commandApprovalTimeoutMinutes \* 60_000/,
  )
  assert.match(dialog, /appSettings\.ai\.commandApprovalTimeoutMinutes/)
  assert.match(dialog, /'commandApprovalTimeoutMinutes'/)
})
