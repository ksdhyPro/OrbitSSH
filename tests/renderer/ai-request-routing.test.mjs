import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const storeSourceUrl = new URL(
  '../../src/renderer/stores/useAiStore.ts',
  import.meta.url,
)

test('AI 请求状态按标签页隔离并使用精确请求 ID 取消', async () => {
  const source = await readFile(storeSourceUrl, 'utf8')

  assert.match(source, /activeRequestsByTabId/)
  assert.match(
    source,
    /Boolean\(activeRequestsByTabId\.value\[activeTabId\.value\]\)/,
  )
  assert.match(
    source,
    /cancel\(\{[\s\S]*?tabId:\s*context\.tabId,[\s\S]*?requestId:\s*activeRequest\.requestId/,
  )
})

test('AI 流式消息和命令卡按请求与对话身份路由', async () => {
  const source = await readFile(storeSourceUrl, 'utf8')

  assert.match(source, /streamStatesByRequestId\.get\(event\.requestId\)/)
  assert.match(source, /streamState\.conversationId\s*!==\s*event\.conversationId/)
  assert.match(source, /event\.card\.conversationId\s*!==\s*event\.conversationId/)
  assert.match(
    source,
    /mergeCommandCards\(event\.tabId,\s*\[event\.card\],\s*event\.conversationId\)/,
  )
})

test('AI 事件监听器只在 Store 生命周期注册一次', async () => {
  const source = await readFile(storeSourceUrl, 'utf8')

  assert.equal(source.match(/onStreamMessageStart\(/g)?.length, 1)
  assert.equal(source.match(/onStreamChunk\(/g)?.length, 1)
  assert.equal(source.match(/onCommandCard\(/g)?.length, 1)
  assert.match(source, /onScopeDispose\(\(\)\s*=>/)
})
