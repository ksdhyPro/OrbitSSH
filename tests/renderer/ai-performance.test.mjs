import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const storeSourceUrl = new URL(
  '../../src/renderer/stores/useAiStore.ts',
  import.meta.url,
)
const panelSourceUrl = new URL(
  '../../src/renderer/components/AiPanel.vue',
  import.meta.url,
)
const markdownSourceUrl = new URL(
  '../../src/renderer/utils/markdown.ts',
  import.meta.url,
)

test('流式消息按 chunk 原地更新，不复制整段消息数组或深度 watch', async () => {
  const source = await readFile(storeSourceUrl, 'utf8')
  const chunkHandler = source.match(
    /function appendStreamChunk[\s\S]*?function hasBlockingCommandProcess/,
  )?.[0]

  assert.match(chunkHandler ?? '', /message\.content \+= chunk/)
  assert.doesNotMatch(chunkHandler ?? '', /messages\.map\(/)
  assert.doesNotMatch(source, /watch\(conversations, schedulePersistConversations, \{ deep: true \}\)/)
})

test('AI 面板限制时间线渲染窗口并缓存 Markdown 结果', async () => {
  const [panel, markdown] = await Promise.all([
    readFile(panelSourceUrl, 'utf8'),
    readFile(markdownSourceUrl, 'utf8'),
  ])

  assert.match(panel, /const timelineRenderLimit = ref\(120\)/)
  assert.match(panel, /timelineItems\.value\.slice\(-timelineRenderLimit\.value\)/)
  assert.match(panel, /@click="showOlderTimelineItems"/)
  assert.match(markdown, /const renderedMarkdownCache = new Map<string, string>\(\)/)
  assert.match(markdown, /renderedMarkdownCache\.get\(content\)/)
})
