import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSourceUrl = new URL('../../src/renderer/App.vue', import.meta.url)
const baseStyleUrl = new URL(
  '../../src/renderer/styles/base.css',
  import.meta.url,
)
const aiStyleUrl = new URL('../../src/renderer/styles/ai.css', import.meta.url)
const aiComposeStyleUrl = new URL(
  '../../src/renderer/styles/ai-compose.css',
  import.meta.url,
)
const sidebarStoreUrl = new URL(
  '../../src/renderer/stores/useSidebarStore.ts',
  import.meta.url,
)

test('AI 模式下对话区作为主视图，不再占用内容区右侧列', async () => {
  const [baseStyle, aiStyle, appSource] = await Promise.all([
    readFile(baseStyleUrl, 'utf8'),
    readFile(aiStyleUrl, 'utf8'),
    readFile(appSourceUrl, 'utf8'),
  ])
  const contentShellRule = baseStyle.match(
    /\.content-shell\s*\{[\s\S]*?\n\}/,
  )?.[0]
  const aiPanelRule = aiStyle.match(/\.ai-panel\s*\{[\s\S]*?\n\}/)?.[0]

  assert.doesNotMatch(contentShellRule ?? '', /--ai-panel-track-width/)
  assert.match(aiPanelRule ?? '', /width:\s*100%/)
  assert.match(aiPanelRule ?? '', /min-width:\s*0/)
  assert.doesNotMatch(appSource, /startAiPanelResize/)
  assert.match(appSource, /<AiPanel\s+layout="workspace"/)
})

test('AI 面板头部和输入操作区允许内容随面板收缩', async () => {
  const aiStyle = [
    await readFile(aiStyleUrl, 'utf8'),
    await readFile(aiComposeStyleUrl, 'utf8'),
  ].join('\n')
  const headerContentRule = aiStyle.match(
    /\.ai-panel-heading\s*\{[\s\S]*?\n\}/,
  )?.[0]
  const modelTriggerRule = aiStyle.match(
    /\.ai-model-trigger\s*\{[\s\S]*?\n\}/,
  )?.[0]

  assert.match(headerContentRule ?? '', /min-width:\s*0/)
  assert.match(modelTriggerRule ?? '', /min-width:\s*0/)
  assert.match(modelTriggerRule ?? '', /flex:\s*0\s+1\s+160px/)
})

test('待批准的长命令限制显示高度并支持鼠标纵向滚动', async () => {
  const aiStyle = await readFile(aiStyleUrl, 'utf8')
  const approvalCommandRule = [
    ...aiStyle.matchAll(/\.ai-approval-popover code\s*\{[\s\S]*?\n\}/g),
  ].at(-1)?.[0]

  assert.match(approvalCommandRule ?? '', /max-height:\s*min\(/)
  assert.match(approvalCommandRule ?? '', /overflow-y:\s*auto/)
})

test('AI 头部与终端标签栏等高且当前连接使用 Tag 展示', async () => {
  const [componentSource, aiStyle] = await Promise.all([
    readFile(
      new URL('../../src/renderer/components/AiPanel.vue', import.meta.url),
      'utf8',
    ),
    readFile(aiStyleUrl, 'utf8'),
  ])
  const headerRule = aiStyle.match(
    /\.ai-panel-header\s*\{[\s\S]*?\n\}/,
  )?.[0]
  const contextTagRule = aiStyle.match(
    /\.ai-context-tag\s*\{[\s\S]*?\n\}/,
  )?.[0]

  assert.match(headerRule ?? '', /height:\s*44px/)
  assert.match(componentSource, /class="ai-context-tag"/)
  assert.match(contextTagRule ?? '', /border-radius:\s*var\(--radius-full\)/)
  assert.match(contextTagRule ?? '', /text-overflow:\s*ellipsis/)
})

test('普通模式（关闭 AI）不渲染 AI 对话，AI 模式左侧仅保留服务器列表', async () => {
  const [appSource, terminalPanelSource] = await Promise.all([
    readFile(appSourceUrl, 'utf8'),
    readFile(
      new URL('../../src/renderer/components/TerminalPanel.vue', import.meta.url),
      'utf8',
    ),
  ])

  assert.match(appSource, /const isAiWorkspace = computed\(\(\) => appSettings\.ai\.enabled\)/)
  assert.match(appSource, /isAiWorkspace\.value \? \["servers"\] : sidebarPanelOrder\.value/)
  assert.match(appSource, /:ai-workspace="isAiWorkspace"/)
  assert.match(terminalPanelSource, /<div v-if="aiWorkspace" class="ai-workspace-main">\s*<slot \/>/)
})
