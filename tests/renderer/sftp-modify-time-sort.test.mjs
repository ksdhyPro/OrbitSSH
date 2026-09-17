import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workspaceUrl = new URL(
  '../../src/renderer/composables/useRemoteFileWorkspace.ts',
  import.meta.url,
)
const panelUrl = new URL(
  '../../src/renderer/components/SftpPanel.vue',
  import.meta.url,
)
const transferDialogUrl = new URL(
  '../../src/renderer/components/DataTransferDialog.vue',
  import.meta.url,
)

test('SFTP 文件列表支持按修改时间正序和倒序排列', async () => {
  const [workspaceSource, panelSource] = await Promise.all([
    readFile(workspaceUrl, 'utf8'),
    readFile(panelUrl, 'utf8'),
  ])

  assert.match(workspaceSource, /ModifyTimeSortDirection = "asc" \| "desc"/)
  assert.match(workspaceSource, /leftTime - rightTime/)
  assert.match(workspaceSource, /rightTime - leftTime/)
  assert.match(workspaceSource, /lastClickedIndex = -1/)
  assert.match(panelSource, /class="file-list-sort-trigger"/)
  assert.match(panelSource, /sort-arrow\.svg/)
  assert.match(panelSource, /emit\('toggleModifyTimeSort'\)/)
})

test('文件传输左右列表可独立切换修改时间排序', async () => {
  const source = await readFile(transferDialogUrl, 'utf8')

  assert.match(source, /modifyTimeSortDirection:\s*"desc"/)
  assert.match(source, /function togglePaneModifyTimeSort/)
  assert.match(source, /leftTime - rightTime/)
  assert.match(source, /rightTime - leftTime/)
  assert.match(source, /togglePaneModifyTimeSort\(leftPane\)/)
  assert.match(source, /togglePaneModifyTimeSort\(rightPane\)/)
  assert.match(source, /左侧修改时间，当前/)
  assert.match(source, /右侧修改时间，当前/)
})
