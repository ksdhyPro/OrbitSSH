import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dialogSourceUrl = new URL(
  '../../src/renderer/components/DataTransferDialog.vue',
  import.meta.url,
)

test('文件传输左右位置下拉均提供本地选项', async () => {
  const source = await readFile(dialogSourceUrl, 'utf8')
  const leftOptions = source.match(
    /const leftServerOptions[\s\S]*?const rightServerOptions/,
  )?.[0]
  const rightOptions = source.match(
    /const rightServerOptions[\s\S]*?const transferMenuItems/,
  )?.[0]

  assert.match(leftOptions ?? '', /value:\s*LOCAL_ENDPOINT_ID/)
  assert.match(rightOptions ?? '', /value:\s*LOCAL_ENDPOINT_ID/)
})

test('左右均为本地时禁用传输', async () => {
  const source = await readFile(dialogSourceUrl, 'utf8')
  const transferGuard = source.match(
    /function canTransferFromPane[\s\S]*?function isContextMultiSelection/,
  )?.[0]

  assert.match(transferGuard ?? '', /hasRemoteEndpoint/)
  assert.match(
    transferGuard ?? '',
    /!isLocalPane\(sourcePane\)\s*\|\|\s*!isLocalPane\(targetPane\)/,
  )
})

test('本地面板提供主目录和全部盘符选择', async () => {
  const source = await readFile(dialogSourceUrl, 'utf8')

  assert.match(source, /window\.orbitSSH\.localFiles\.listRoots\(\)/)
  assert.match(source, /const localRootOptions = computed/)
  assert.match(source, /ariaLabel="左侧本地盘符"/)
  assert.match(source, /ariaLabel="右侧本地盘符"/)
  assert.match(source, /selectLocalRoot\('left', \$event\)/)
  assert.match(source, /selectLocalRoot\('right', \$event\)/)
})

test('文件传输支持系统文件拖入、跨面板拖拽和显式文件选择', async () => {
  const source = await readFile(dialogSourceUrl, 'utf8')

  assert.match(source, /function hasExternalFileDrag/)
  assert.match(source, /localFiles\.getPathForFile\(file\)/)
  assert.match(source, /function canTransferNodesToPane/)
  assert.match(source, /function dropOnTransferPane/)
  assert.match(source, /submitTransferFromPane\(sourcePaneKey, targetNode\.path\)/)
  assert.match(source, /uploadLocalPathsToTransferPane/)
  assert.match(source, />\s*选择文件\s*</)
  assert.match(source, />\s*选择文件夹\s*</)
  assert.match(source, />\s*传到右侧\s*</)
  assert.match(source, />\s*传到左侧\s*</)
})
