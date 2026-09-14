import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsUrl = new URL('../../src/shared/settings.ts', import.meta.url)
const settingsDialogUrl = new URL('../../src/renderer/components/SettingsDialog.vue', import.meta.url)
const transferQueueUrl = new URL('../../src/main/sftp/sftp-transfer-common.ts', import.meta.url)

test('SFTP 传输并发默认值为 3 且最大值为 5', async () => {
  const settingsSource = await readFile(settingsUrl, 'utf8')

  assert.match(settingsSource, /SFTP_TRANSFER_CONCURRENCY_MAX\s*=\s*5/)
  assert.match(settingsSource, /sftpMaxConcurrentTransfers:\s*3/)
})

test('设置页使用下拉菜单选择 1 到 5 个并发任务', async () => {
  const dialogSource = await readFile(settingsDialogUrl, 'utf8')

  assert.match(
    dialogSource,
    /SFTP_TRANSFER_CONCURRENCY_MAX - SFTP_TRANSFER_CONCURRENCY_MIN \+ 1/,
  )
  assert.match(dialogSource, /<AppSelect[\s\S]*?sftpMaxConcurrentTransfers/)
  assert.match(dialogSource, /updateSftpMaxConcurrentTransfers/)
})

test('提高并发数后立即补满空闲传输槽位', async () => {
  const queueSource = await readFile(transferQueueUrl, 'utf8')

  assert.match(
    queueSource,
    /while \(activeTransferCount < getMaxConcurrentTransferTasks\(\)\)/,
  )
  assert.match(
    queueSource,
    /export function setMaxConcurrentTransferTasks[\s\S]*?runNextQueuedTransfer\(\)/,
  )
})
