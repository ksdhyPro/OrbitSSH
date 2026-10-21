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

test('AI 模式下标签右键菜单提供打开 SSH，并复用 AppDialog 承载现有终端区域', async () => {
  const [terminalPanel, terminalsStore] = await Promise.all([
    readFile(terminalPanelFile, 'utf8'),
    readFile(new URL('../../src/renderer/stores/useTerminalsStore.ts', import.meta.url), 'utf8'),
  ])

  assert.match(terminalPanel, /props\.aiWorkspace\s*\?\s*\[\{ key: "open-ssh", label: "打开 SSH" \}\]/)
  assert.match(terminalPanel, /terminalsStore\.openTerminalDialog\(targetTabId\)/)
  assert.match(terminalPanel, /<AppDialog\s+v-if="isTerminalDialogVisible"[\s\S]*?width="terminal"/)
  // 终端区域整体在原位与弹窗之间移动，不重新创建 xterm 实例。
  assert.match(terminalPanel, /nextParent\.appendChild\(stage\)/)
  assert.match(terminalsStore, /async function openTerminalDialog\(tabId: string\)/)
})
