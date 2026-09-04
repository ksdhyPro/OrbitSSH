import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appDialogUrl = new URL('../../src/renderer/components/AppDialog.vue', import.meta.url)
const dialogStyleUrl = new URL('../../src/renderer/styles/dialogs.css', import.meta.url)
const formStyleUrl = new URL('../../src/renderer/styles/forms-and-status.css', import.meta.url)
const aiStyleUrl = new URL('../../src/renderer/styles/ai-settings.css', import.meta.url)

function getRule(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? ''
}

test('AppDialog 统一提供默认内容边距', async () => {
  const [appDialog, dialogStyle] = await Promise.all([
    readFile(appDialogUrl, 'utf8'),
    readFile(dialogStyleUrl, 'utf8'),
  ])

  assert.match(appDialog, /class="app-dialog-body"[\s\S]*?<slot\s*\/>/)
  assert.match(getRule(dialogStyle, '.app-dialog-body'), /padding:\s*16px/)
})

test('业务弹窗不再重复维护外层内容边距', async () => {
  const [dialogStyle, formStyle, aiStyle] = await Promise.all([
    readFile(dialogStyleUrl, 'utf8'),
    readFile(formStyleUrl, 'utf8'),
    readFile(aiStyleUrl, 'utf8'),
  ])
  const rules = [
    [dialogStyle, '.connection-form'],
    [dialogStyle, '.automation-task-form'],
    [dialogStyle, '.automation-run-dialog'],
    [dialogStyle, '.ai-config-dialog'],
    [formStyle, '.update-dialog-content'],
    [formStyle, '.data-transfer-dialog'],
    [formStyle, '.confirm-dialog-content'],
    [formStyle, '.delete-confirm-content'],
    [aiStyle, '.ai-config-form'],
  ]

  for (const [source, selector] of rules) {
    const rule = getRule(source, selector)
    assert.doesNotMatch(rule, /\bpadding\s*:/, `${selector} 不应重复设置外层边距`)
  }
})
