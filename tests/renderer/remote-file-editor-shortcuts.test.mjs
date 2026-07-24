import assert from 'node:assert/strict'
import { EditorState, Text } from '@codemirror/state'
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

test('远程文件编辑器按 CodeMirror 文档长度定位光标并保留换行符', async () => {
  const [stateSource, storeSource] = await Promise.all([
    readFile(editorStateSourceUrl, 'utf8'),
    readFile(editorStoreSourceUrl, 'utf8'),
  ])

  assert.match(
    stateSource,
    /const document = Text\.of\(content\.split\(\/\\r\\n\|\\r\|\\n\/\)\)/,
  )
  assert.match(stateSource, /selection:\s*\{\s*anchor:\s*document\.length/)
  assert.match(stateSource, /EditorState\.lineSeparator\.of\(lineSeparator\)/)
  assert.match(storeSource, /state\.sliceDoc\(\)/)
})

test('CRLF 文本的末尾光标不会超出 CodeMirror 文档', () => {
  const content = 'services:\r\n  app:\r\n    image: orbitssh'
  const document = Text.of(content.split(/\r\n|\r|\n/))
  const state = EditorState.create({
    doc: document,
    selection: { anchor: document.length },
    extensions: [EditorState.lineSeparator.of('\r\n')],
  })

  assert.equal(state.selection.main.anchor, state.doc.length)
  assert.equal(state.sliceDoc(), content)
})
