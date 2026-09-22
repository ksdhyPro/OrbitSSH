import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dialogUrl = new URL('../../src/renderer/components/TransferTaskDialog.vue', import.meta.url)
const styleUrl = new URL('../../src/renderer/styles/transfer-tasks.css', import.meta.url)
const managerUrl = new URL('../../src/main/sftp/sftp-managed-task-manager.ts', import.meta.url)

test('传输文件直接从第一层展示且不再渲染批次头部', async () => {
  const dialogSource = await readFile(dialogUrl, 'utf8')

  assert.match(
    dialogSource,
    /function visibleRows[\s\S]*?appendRows\(batch\.taskId, undefined, 0, rows\)/,
  )
  assert.doesNotMatch(dialogSource, /transfer-task-batch-header/)
  assert.doesNotMatch(dialogSource, /expandedIds\.has\(`batch:/)
})

test('批次之间仅使用分隔线区分', async () => {
  const styleSource = await readFile(styleUrl, 'utf8')

  assert.match(
    styleSource,
    /\.transfer-task-batch \+ \.transfer-task-batch\s*\{[\s\S]*?border-top:/,
  )
  assert.doesNotMatch(
    styleSource.match(/\.transfer-task-batch\s*\{[\s\S]*?\n\}/)?.[0] ?? '',
    /border-radius|background/,
  )
})

test('调度器只从最早的未完成批次分配任务', async () => {
  const managerSource = await readFile(managerUrl, 'utf8')

  assert.match(managerSource, /activeBatchId \?\? batchOrder\[0\]/)
  assert.match(managerSource, /if \(activeWorkerCount > 0\) return/)
  assert.doesNotMatch(managerSource, /nextBatchIndex/)
  assert.doesNotMatch(managerSource, /for \(let offset = 0; offset < batchOrder\.length/)
})
