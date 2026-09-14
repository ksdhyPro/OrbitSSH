import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const terminalPanelFile = new URL('../../src/renderer/components/TerminalPanel.vue', import.meta.url)
const appFile = new URL('../../src/renderer/App.vue', import.meta.url)

test('终端标签右键菜单复用通用组件并提供批量关闭操作', async () => {
  const [terminalPanel, app] = await Promise.all([
    readFile(terminalPanelFile, 'utf8'),
    readFile(appFile, 'utf8'),
  ])

  assert.match(terminalPanel, /@contextmenu="openTabContextMenu\(\$event, tab\.id\)"/)
  assert.match(terminalPanel, /label: "关闭全部"/)
  assert.match(terminalPanel, /label: "关闭右侧终端"/)
  assert.match(terminalPanel, /:menu="tabContextMenu"/)
  assert.match(terminalPanel, /props\.tabs\.slice\(targetIndex \+ 1\)/)
  assert.match(app, /@close-tabs="closeTerminalTabs"/)
})
