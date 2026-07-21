import type { AiAttachment } from './ai.js'
import type { AiInputModality, AiModelConfig } from './settings.js'

type AiAttachmentDescriptor = Pick<AiAttachment, 'mimeType'> &
  Partial<Pick<AiAttachment, 'name'>>

const imageExtensions = new Set([
  'avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp'
])
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'])
const videoExtensions = new Set(['avi', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'])

function getFileExtension(name: string | undefined): string {
  return name?.split('.').pop()?.trim().toLowerCase() ?? ''
}

export function getAttachmentInputModality(
  attachment: AiAttachmentDescriptor
): Exclude<AiInputModality, 'text'> {
  const mimeType = attachment.mimeType.toLowerCase()
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType === 'application/pdf') return 'pdf'
  const extension = getFileExtension(attachment.name)
  if (imageExtensions.has(extension)) return 'image'
  if (audioExtensions.has(extension)) return 'audio'
  if (videoExtensions.has(extension)) return 'video'
  if (extension === 'pdf') return 'pdf'
  return 'file'
}

export function supportsAiAttachment(
  config: AiModelConfig,
  attachment: AiAttachmentDescriptor
): boolean {
  if (!config.supportsAttachments) return false
  const configuredModalities = config.inputModalities.filter(item => item !== 'text')
  if (configuredModalities.length === 0) return true

  const modality = getAttachmentInputModality(attachment)
  return (
    configuredModalities.includes(modality) ||
    (modality === 'pdf' && configuredModalities.includes('file'))
  )
}

export function resolveAiConfigForAttachments(
  configs: AiModelConfig[],
  activeConfigId: string,
  multimodalConfigId: string,
  attachments: AiAttachmentDescriptor[]
): AiModelConfig | null {
  if (attachments.length === 0) {
    return configs.find(config => config.id === activeConfigId) ?? configs[0] ?? null
  }

  const preferredIds = Array.from(new Set([
    multimodalConfigId,
    activeConfigId
  ].filter(Boolean)))
  for (const configId of preferredIds) {
    const config = configs.find(item => item.id === configId)
    if (config && attachments.every(attachment => supportsAiAttachment(config, attachment))) {
      return config
    }
  }

  return configs.find(config =>
    attachments.every(attachment => supportsAiAttachment(config, attachment))
  ) ?? null
}
