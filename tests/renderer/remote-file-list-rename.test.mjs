import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('重命名输入框只在重命名目标变化时重新聚焦和全选', async () => {
  const source = await readFile(
    new URL('../../src/renderer/components/RemoteFileList.vue', import.meta.url),
    'utf8',
  )
  const watcher = source.match(
    /watch\([\s\S]*?void focusRenameInput\(\);[\s\S]*?\n\);/,
  )?.[0]

  assert.ok(watcher, '未找到重命名输入框的聚焦监听器')
  assert.match(watcher, /\(\) => props\.renamingPath/)
  assert.doesNotMatch(watcher, /props\.nodes/)
})
