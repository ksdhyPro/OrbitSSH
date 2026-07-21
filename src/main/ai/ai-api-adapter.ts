import type { AiContentPart } from '../../shared/ai.js'
import type { AiApiSpec, AiModelConfig } from '../../shared/settings.js'
import { setAiReasoningRequestValue } from '../../shared/ai-reasoning.js'

export interface AiApiMessage {
  role: 'system' | 'assistant' | 'user'
  content: string | AiContentPart[]
}

export interface AiApiTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

export interface AiApiRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function buildEndpoint(baseUrl: string, spec: AiApiSpec): string {
  const path = spec === 'responses'
    ? 'responses'
    : spec === 'anthropic'
      ? 'messages'
      : 'chat/completions'
  const root = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|responses|messages)$/i, '')
  return `${root}/${path}`
}

function parseDataUrl(dataUrl: string): {
  mediaType: string
  data: string
} | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  return match ? { mediaType: match[1], data: match[2] } : null
}

function toResponsesContent(parts: AiContentPart[]): Array<Record<string, unknown>> {
  return parts.flatMap<Record<string, unknown>>(part => {
    if (part.type === 'text') return [{ type: 'input_text', text: part.text }]
    if (part.type === 'image_url') {
      return [{ type: 'input_image', image_url: part.image_url.url }]
    }
    if (part.type === 'file') {
      return [{
        type: 'input_file',
        filename: part.file.filename,
        file_data: part.file.file_data
      }]
    }
    if (part.type === 'input_audio') {
      return [{ type: 'input_audio', input_audio: part.input_audio }]
    }
    return [{ type: 'input_video', video_url: part.video_url.url }]
  })
}

function toAnthropicContent(parts: AiContentPart[]): Array<Record<string, unknown>> {
  return parts.flatMap<Record<string, unknown>>(part => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }]
    if (part.type === 'image_url') {
      const data = parseDataUrl(part.image_url.url)
      return data
        ? [{
            type: 'image',
            source: { type: 'base64', media_type: data.mediaType, data: data.data }
          }]
        : []
    }
    if (part.type === 'file') {
      const data = parseDataUrl(part.file.file_data)
      return data
        ? [{
            type: 'document',
            title: part.file.filename,
            source: { type: 'base64', media_type: data.mediaType, data: data.data }
          }]
        : []
    }
    if (part.type === 'input_audio') {
      return [{
        type: 'document',
        source: {
          type: 'base64',
          media_type: `audio/${part.input_audio.format}`,
          data: part.input_audio.data
        }
      }]
    }
    const data = parseDataUrl(part.video_url.url)
    return data
      ? [{
          type: 'document',
          source: { type: 'base64', media_type: data.mediaType, data: data.data }
        }]
      : []
  })
}

function applyReasoningConfig(
  body: Record<string, unknown>,
  config: AiModelConfig,
  enabled: boolean
): void {
  if (!enabled || !config.reasoningEnabled) return
  if (!setAiReasoningRequestValue(
    body,
    config.reasoningParameter,
    config.reasoningEffort
  )) return

  if (config.reasoningParameter === 'thinking.budget_tokens') {
    const thinking = body.thinking as Record<string, unknown>
    thinking.type = 'enabled'
  } else if (
    config.spec === 'anthropic' &&
    config.reasoningParameter === 'output_config.effort'
  ) {
    body.thinking = { type: 'adaptive' }
  }
}

function buildOpenAiChatBody(
  config: AiModelConfig,
  messages: AiApiMessage[],
  tools: AiApiTool[],
  maxOutputTokens: number,
  stream: boolean,
  includeReasoning: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    ...(tools.length ? { tools } : {}),
    max_tokens: maxOutputTokens,
    ...(stream ? { stream: true } : {})
  }
  applyReasoningConfig(body, config, includeReasoning)
  return body
}

function buildResponsesBody(
  config: AiModelConfig,
  messages: AiApiMessage[],
  tools: AiApiTool[],
  maxOutputTokens: number,
  stream: boolean,
  includeReasoning: boolean
): Record<string, unknown> {
  const input = messages.map(message => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : toResponsesContent(message.content)
  }))
  const responseTools = tools.map(tool => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    ...(tool.function.strict === undefined ? {} : { strict: tool.function.strict })
  }))
  const body: Record<string, unknown> = {
    model: config.model,
    input,
    ...(responseTools.length ? { tools: responseTools } : {}),
    max_output_tokens: maxOutputTokens,
    ...(stream ? { stream: true } : {})
  }
  applyReasoningConfig(body, config, includeReasoning)
  return body
}

function buildAnthropicBody(
  config: AiModelConfig,
  messages: AiApiMessage[],
  tools: AiApiTool[],
  maxOutputTokens: number,
  stream: boolean,
  includeReasoning: boolean
): Record<string, unknown> {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => typeof message.content === 'string' ? message.content : '')
    .filter(Boolean)
    .join('\n\n')
  const anthropicMessages = messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role,
      content: typeof message.content === 'string'
        ? message.content
        : toAnthropicContent(message.content)
    }))
  const anthropicTools = tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters
  }))
  const body: Record<string, unknown> = {
    model: config.model,
    ...(system ? { system } : {}),
    messages: anthropicMessages,
    ...(anthropicTools.length ? { tools: anthropicTools } : {}),
    max_tokens: maxOutputTokens,
    ...(stream ? { stream: true } : {})
  }
  applyReasoningConfig(body, config, includeReasoning)
  return body
}

export function createAiApiRequest(
  config: AiModelConfig,
  messages: AiApiMessage[],
  tools: AiApiTool[],
  maxOutputTokens = config.maxOutputTokens,
  stream = false,
  includeReasoning = true
): AiApiRequest {
  const body = config.spec === 'responses'
    ? buildResponsesBody(
        config,
        messages,
        tools,
        maxOutputTokens,
        stream,
        includeReasoning
      )
    : config.spec === 'anthropic'
      ? buildAnthropicBody(
          config,
          messages,
          tools,
          maxOutputTokens,
          stream,
          includeReasoning
        )
      : buildOpenAiChatBody(
          config,
          messages,
          tools,
          maxOutputTokens,
          stream,
          includeReasoning
        )

  return {
    url: buildEndpoint(config.baseUrl, config.spec),
    headers: config.spec === 'anthropic'
      ? {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      : {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
    body
  }
}
