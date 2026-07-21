import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const panelUrl = new URL(
  '../../src/renderer/components/AiPanel.vue',
  import.meta.url,
)
const storeUrl = new URL(
  '../../src/renderer/stores/useAiStore.ts',
  import.meta.url,
)
const previewUrl = new URL(
  '../../src/renderer/components/AiAttachmentPreviewDialog.vue',
  import.meta.url,
)
const storageUrl = new URL(
  '../../src/renderer/utils/ai-attachment-storage.ts',
  import.meta.url,
)
const settingsDialogUrl = new URL(
  '../../src/renderer/components/SettingsDialog.vue',
  import.meta.url,
)

test('AI 输入框支持粘贴图片和文件附件', async () => {
  const panel = await readFile(panelUrl, 'utf8')

  assert.match(panel, /async function handleComposePaste\(event: ClipboardEvent\)/)
  assert.match(panel, /item\.kind === "file"/)
  assert.match(panel, /item\.getAsFile\(\)/)
  assert.match(panel, /clipboard\.getData\("text\/plain"\)/)
  assert.match(panel, /readImageDataUrl/)
  assert.match(panel, /dataUrlToPastedImageFile/)
  assert.match(panel, /@paste="handleComposePaste"/)
})

test('附件发送前转换为可被 Electron IPC 克隆的纯对象', async () => {
  const store = await readFile(storeUrl, 'utf8')

  assert.match(store, /function toPlainAiAttachments\(/)
  assert.match(store, /name: String\(attachment\.name\)/)
  assert.match(store, /dataUrl: String\(attachment\.dataUrl\)/)
  assert.match(store, /const attachments = toPlainAiAttachments\(pendingAttachments\.value\)/)
})

test('附件会预检模型能力并显示实际路由模型', async () => {
  const [panel, store] = await Promise.all([
    readFile(panelUrl, 'utf8'),
    readFile(storeUrl, 'utf8'),
  ])

  assert.match(store, /resolveAiConfigForAttachments\(/)
  assert.match(store, /aiSettings\.multimodalConfigId/)
  assert.match(panel, /附件将使用 \{\{ attachmentModelName \}\}/)
})

test('剪贴板图片缺少 MIME 时会按扩展名识别为图片', async () => {
  const store = await readFile(storeUrl, 'utf8')

  assert.match(store, /png: "image\/png"/)
  assert.match(store, /name: file\.name,\s+mimeType: getAttachmentMimeType\(file\)/)
})

test('已发送附件挂载到消息并支持图片、文本、PDF 和媒体预览', async () => {
  const [store, panel, preview] = await Promise.all([
    readFile(storeUrl, 'utf8'),
    readFile(panelUrl, 'utf8'),
    readFile(previewUrl, 'utf8'),
  ])

  assert.match(store, /createMessageAttachments\(attachments\)/)
  assert.match(store, /createMessage\("user", messageContent, messageAttachments\)/)
  assert.match(panel, /item\.message\.attachments/)
  assert.match(panel, /openMessageAttachment\(attachment\)/)
  assert.match(panel, /<ImagePreviewDialog/)
  assert.match(panel, /<AiAttachmentPreviewDialog/)
  assert.match(preview, /v-else-if="isText"/)
  assert.match(preview, /v-else-if="isPdf"/)
  assert.match(preview, /v-else-if="isAudio"/)
  assert.match(preview, /v-else-if="isVideo"/)
})

test('附件正文存入 IndexedDB 且 localStorage 只保存轻量引用', async () => {
  const [store, storage] = await Promise.all([
    readFile(storeUrl, 'utf8'),
    readFile(storageUrl, 'utf8'),
  ])

  assert.match(storage, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/)
  assert.match(storage, /export async function saveAiAttachments/)
  assert.match(storage, /export async function loadAiAttachments/)
  assert.match(storage, /export async function deleteAiAttachments/)
  assert.match(store, /\(\{ dataUrl: _dataUrl, \.\.\.attachment \}\) => attachment/)
  assert.match(store, /saveAiAttachments\(messageAttachments\)/)
  assert.match(store, /loadAiAttachments\(storedAttachments\)/)
})

test('AI 单附件上限可配置且大型文本标记为分段读取', async () => {
  const [store, settingsDialog] = await Promise.all([
    readFile(storeUrl, 'utf8'),
    readFile(settingsDialogUrl, 'utf8'),
  ])

  assert.match(store, /appSettings\.ai\.maxAttachmentSizeMb/)
  assert.match(store, /AI_TEXT_ATTACHMENT_CHUNK_THRESHOLD_BYTES/)
  assert.match(store, /isAiTextAttachment/)
  assert.match(store, /delivery: getAttachmentDelivery/)
  assert.match(settingsDialog, /单个 AI 附件上限（MB）/)
  assert.match(settingsDialog, /'maxAttachmentSizeMb'/)
})

test('大型文本预览最多解码前 256 KB', async () => {
  const preview = await readFile(previewUrl, 'utf8')

  assert.match(preview, /MAX_TEXT_PREVIEW_BYTES = 256 \* 1024/)
  assert.match(preview, /payload\.slice\(0, alignedLength\)/)
  assert.match(preview, /仅预览前 256 KB/)
})
