import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSourceUrl = new URL('../../src/renderer/App.vue', import.meta.url)
const baseStyleUrl = new URL(
  '../../src/renderer/styles/base.css',
  import.meta.url,
)
const aiStyleUrl = new URL('../../src/renderer/styles/ai.css', import.meta.url)
const sidebarStoreUrl = new URL(
  '../../src/renderer/stores/useSidebarStore.ts',
  import.meta.url,
)

test('AI 面板宽度由内容区网格统一约束', async () => {
  const [baseStyle, aiStyle] = await Promise.all([
    readFile(baseStyleUrl, 'utf8'),
    readFile(aiStyleUrl, 'utf8'),
  ])
  const contentShellRule = baseStyle.match(
    /\.content-shell\s*\{[\s\S]*?\n\}/,
  )?.[0]
  const aiPanelRule = aiStyle.match(/\.ai-panel\s*\{[\s\S]*?\n\}/)?.[0]

  assert.match(
    contentShellRule ?? '',
    /minmax\(0,\s*var\(--ai-panel-track-width/,
  )
  assert.match(aiPanelRule ?? '', /width:\s*100%/)
  assert.match(aiPanelRule ?? '', /min-width:\s*0/)
})

test('AI 面板拖拽使用内容区真实右边界计算宽度', async () => {
  const [appSource, storeSource] = await Promise.all([
    readFile(appSourceUrl, 'utf8'),
    readFile(sidebarStoreUrl, 'utf8'),
  ])

  assert.match(appSource, /getContentShellRightBoundary\(\)/)
  assert.match(
    appSource,
    /startAiPanelResize\([\s\S]*?getContentShellRightBoundary\(\)/,
  )
  assert.match(
    storeSource,
    /aiPanelRightBoundary\s*-\s*event\.clientX/,
  )
})

test('AI 面板头部和输入操作区允许内容随面板收缩', async () => {
  const aiStyle = await readFile(aiStyleUrl, 'utf8')
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
  assert.match(contextTagRule ?? '', /border-radius:\s*999px/)
  assert.match(contextTagRule ?? '', /text-overflow:\s*ellipsis/)
})

test('关闭 AI 设置后移除主界面整个 AI 区域', async () => {
  const appSource = await readFile(appSourceUrl, 'utf8')
  const enabledRenderGuards = appSource.match(
    /v-if="appSettings\.ai\.enabled"/g,
  )

  assert.equal(enabledRenderGuards?.length, 2)
  assert.match(
    appSource,
    /'--ai-panel-track-width':\s*!appSettings\.ai\.enabled\s*\?\s*'0px'/,
  )
  assert.match(
    appSource,
    /'--ai-panel-resizer-width':[\s\S]{0,100}appSettings\.ai\.enabled\s*&&\s*isAiPanelOpen\s*\?\s*'6px'\s*:\s*'0px'/,
  )
})
