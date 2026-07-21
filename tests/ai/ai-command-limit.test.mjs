import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsUrl = new URL('../../src/shared/settings.ts', import.meta.url)
const agentUrl = new URL('../../src/main/ai/ai-agent.ts', import.meta.url)
const dialogUrl = new URL(
  '../../src/renderer/components/SettingsDialog.vue',
  import.meta.url,
)

test('AI 单次任务命令上限默认 20 且可在设置中调整', async () => {
  const [settings, agent, dialog] = await Promise.all([
    readFile(settingsUrl, 'utf8'),
    readFile(agentUrl, 'utf8'),
    readFile(dialogUrl, 'utf8'),
  ])

  assert.match(settings, /maxAgentCommandCount:\s*20/)
  assert.match(agent, /const maxAgentCommandCount = settings\.ai\.maxAgentCommandCount/)
  assert.match(dialog, /appSettings\.ai\.maxAgentCommandCount/)
  assert.match(dialog, /'maxAgentCommandCount'/)
})

test('agent loop 在执行前拦截本轮重复命令', async () => {
  const agent = await readFile(agentUrl, 'utf8')

  assert.match(agent, /findExecutedAiCommand\(executedCommands, nextCommand\.command\)/)
  assert.match(agent, /AI 重复命令已拦截/)
})

test('有副作用的命令成功后关闭工具并只生成最终总结', async () => {
  const agent = await readFile(agentUrl, 'utf8')

  assert.match(agent, /shouldFinalizeAfterAiCommand/)
  assert.match(agent, /appendFinalExecutionSummary/)
  assert.match(agent, /toolsEnabled: false, finalSummary: true/)
  assert.match(agent, /AI 最终总结阶段返回了命令调用，已忽略/)
  assert.match(
    agent,
    /shouldFinalizeAfterAiCommand\(\s*evaluatedCommand,[\s\S]*?return \{\s*messages,\s*commandCards,/,
  )
})
