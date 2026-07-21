import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAttachmentInputModality,
  resolveAiConfigForAttachments,
  supportsAiAttachment,
} from '../../dist-electron/shared/ai-model-capabilities.js'

const config = {
  supportsAttachments: true,
  inputModalities: ['text', 'image', 'file'],
}

test('模型附件能力按 MIME 类型和配置模态校验', () => {
  assert.equal(getAttachmentInputModality({ mimeType: 'image/png' }), 'image')
  assert.equal(supportsAiAttachment(config, { mimeType: 'image/png' }), true)
  assert.equal(supportsAiAttachment(config, { mimeType: 'application/pdf' }), true)
  assert.equal(supportsAiAttachment(config, { mimeType: 'audio/mpeg' }), false)
  assert.equal(
    getAttachmentInputModality({
      name: 'clipboard-image.png',
      mimeType: 'application/octet-stream',
    }),
    'image',
  )
})

test('专用多模态模型不匹配时会回退到支持附件的当前模型', () => {
  const active = { id: 'active', ...config }
  const staleMultimodal = {
    id: 'stale',
    supportsAttachments: true,
    inputModalities: ['text', 'audio'],
  }
  const selected = resolveAiConfigForAttachments(
    [active, staleMultimodal],
    'active',
    'stale',
    [{ name: 'image.png', mimeType: 'image/png' }],
  )

  assert.equal(selected?.id, 'active')
})
