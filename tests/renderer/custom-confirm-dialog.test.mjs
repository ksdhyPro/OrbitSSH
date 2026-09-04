import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const rendererFiles = [
  new URL('../../src/renderer/App.vue', import.meta.url),
  new URL('../../src/renderer/components/PortForwardDialog.vue', import.meta.url),
  new URL('../../src/renderer/components/ServerSidebar.vue', import.meta.url),
]

test('删除操作使用应用内确认弹窗而非原生确认框', async () => {
  const [app, portForward, sidebar] = await Promise.all(rendererFiles.map(file => readFile(file, 'utf8')))

  for (const source of [app, portForward, sidebar]) {
    assert.doesNotMatch(source, /window\.confirm\s*\(/)
  }
  assert.match(portForward, /DeleteConfirmDialog/)
  assert.match(portForward, /@confirm="remove"/)
  assert.match(sidebar, /DeleteConfirmDialog/)
  assert.match(app, /requestConfirm\(/)
})
