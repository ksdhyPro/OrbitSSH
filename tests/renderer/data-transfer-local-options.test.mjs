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
