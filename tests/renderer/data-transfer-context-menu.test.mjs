import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readRendererStyles } from './helpers/styles.mjs'

const dialogUrl = new URL('../../src/renderer/components/DataTransferDialog.vue', import.meta.url)
const contextMenuUrl = new URL('../../src/renderer/components/ContextMenu.vue', import.meta.url)

function getRule(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? ''
}

test('文件传输右键菜单使用鼠标视口坐标并挂载到 body', async () => {
  const [dialog, contextMenu, formStyle] = await Promise.all([
    readFile(dialogUrl, 'utf8'),
    readFile(contextMenuUrl, 'utf8'),
    readRendererStyles(),
  ])

  // clientX/clientY 属于视口坐标，菜单必须脱离弹窗定位上下文，避免位置随弹窗偏移。
  assert.match(dialog, /import\s*\{\s*resolveMenuPlacement\s*\}\s*from\s*"\.\.\/utils\/menu-position"/)
  assert.match(
    dialog,
    /return resolveMenuPlacement\(\s*\{\s*x:\s*event\.clientX,\s*y:\s*event\.clientY\s*\}/,
  )
  assert.match(
    dialog,
    /<Teleport to="body">[\s\S]*?<ContextMenu[\s\S]*?menu-class="data-transfer-context-menu"[\s\S]*?<\/Teleport>/,
  )

  // ContextMenu 是多根组件，必须显式把专用类传给真实的 FloatingMenu 根节点。
  assert.match(contextMenu, /menuClass\?:\s*string/)
  assert.match(contextMenu, /:class="\['context-menu',\s*menuClass\]"/)

  const menuRule = getRule(formStyle, '.data-transfer-context-menu')
  assert.match(menuRule, /position:\s*fixed/)
  assert.doesNotMatch(menuRule, /position:\s*absolute/)
})
