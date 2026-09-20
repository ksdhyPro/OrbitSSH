import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsDialogUrl = new URL(
  '../../src/renderer/components/SettingsDialog.vue',
  import.meta.url,
)
const settingsStoreUrl = new URL(
  '../../src/renderer/stores/useSettingsStore.ts',
  import.meta.url,
)
const aiSettingsStyleUrl = new URL(
  '../../src/renderer/styles/ai-settings.css',
  import.meta.url,
)

test('预提示词使用本地草稿并通过保存按钮提交', async () => {
  const source = await readFile(settingsDialogUrl, 'utf8')

  assert.match(source, /v-model="aiPresetPromptDraft"/)
  assert.match(source, /@click="saveAiPresetPrompt"/)
  assert.match(source, /emit\("updateAiSetting", "presetPrompt", aiPresetPromptDraft\.value\)/)
  assert.doesNotMatch(source, /@change=[\s\S]{0,160}'presetPrompt'/)
})

test('预提示词包含在本地设置保存数据中', async () => {
  const source = await readFile(settingsStoreUrl, 'utf8')

  assert.match(source, /presetPrompt:\s*appSettings\.ai\.presetPrompt/)
  assert.match(source, /settings\.save\([\s\S]*?toPlainAppSettings\(\)/)
})

test('预提示词区域使用单列内容高度布局，拖拽文本框时会撑开下一设置项', async () => {
  const source = await readFile(aiSettingsStyleUrl, 'utf8')

  assert.match(
    source,
    /\.settings-page\s+\.ai-preset-prompt-field\s*\{(?=[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\))(?=[^}]*height:\s*max-content)[^}]*\}/s,
  )
})
