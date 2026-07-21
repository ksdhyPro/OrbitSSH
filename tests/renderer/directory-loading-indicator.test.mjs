import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = name => readFile(new URL(`../../src/${name}`, import.meta.url), 'utf8')

test('文件列表在双击目录和返回行时显示行内加载动画并阻止重复操作', async () => {
  const [list, panel, store, transfer, styles] = await Promise.all([
    source('renderer/components/RemoteFileList.vue'),
    source('renderer/components/SftpPanel.vue'),
    source('renderer/stores/useSftpStore.ts'),
    source('renderer/components/DataTransferDialog.vue'),
    source('renderer/styles/remote-files.css'),
  ])

  assert.match(list, /loadingPaths\?: Set<string>/)
  assert.match(list, /function isLoading\(node: RemoteFileListNode\)/)
  assert.match(list, /class="file-node-spinner"/)
  assert.match(list, /aria-label="正在加载目录"/)
  assert.match(list, /@dblclick="!isNodeBusy\(node\) && emit\('openNode', node\)"/)
  assert.match(panel, /:loading-paths="activeSftpTree\?\.loadingPaths/)
  assert.match(store, /loadingPaths: new Set<string>\(\[targetPath\]\)/)
  assert.match(store, /loadingPaths\.delete\(targetPath\)/)

  assert.match(transfer, /loadingPath: string/)
  assert.match(transfer, /pane\.loadingPath = targetPath/)
  assert.match(transfer, /pane\.loadingPath = ""/)
  assert.match(transfer, /leftPane\.loading && !leftPane\.loadingPath/)
  assert.match(transfer, /rightPane\.loading && !rightPane\.loadingPath/)
  assert.match(transfer, /:loading-paths="getPaneLoadingPaths\(leftPane\)"/)
  assert.match(transfer, /:loading-paths="getPaneLoadingPaths\(rightPane\)"/)

  assert.match(styles, /\.file-node-spinner\s*\{[\s\S]*animation: file-node-spin/)
  assert.match(styles, /@keyframes file-node-spin/)
})
