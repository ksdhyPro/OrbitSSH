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
