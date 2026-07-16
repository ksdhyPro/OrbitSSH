import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const editorStateSourceUrl = new URL(
  '../../src/renderer/utils/codemirror/state.ts',
  import.meta.url,
)
const editorStoreSourceUrl = new URL(
  '../../src/renderer/stores/useFileEditorStore.ts',
  import.meta.url,
)

test('远程文件编辑器绑定保存快捷键并阻止浏览器默认行为', async () => {
  const [stateSource, storeSource] = await Promise.all([
    readFile(editorStateSourceUrl, 'utf8'),
    readFile(editorStoreSourceUrl, 'utf8'),
  ])

  assert.match(stateSource, /key:\s*["']Mod-s["']/)
  assert.match(stateSource, /onSaveShortcut\(\)/)
  assert.match(storeSource, /onSaveShortcut:[\s\S]{0,120}saveFileEditor\(\)/)
})

test('远程文件编辑器首次加载内容时把光标放到末尾', async () => {
  const source = await readFile(editorStateSourceUrl, 'utf8')

  assert.match(
    source,
    /selection:[\s\S]{0,80}anchor:\s*content\.length/,
  )
})
