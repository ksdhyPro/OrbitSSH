import assert from 'node:assert/strict'
import test from 'node:test'

import { createAiApiRequest } from '../../dist-electron/main/ai/ai-api-adapter.js'
import {
  collectAiApiStream,
  parseAiApiResponsePayload,
} from '../../dist-electron/main/ai/ai-response-parser.js'
import {
  getAiReasoningDefaults,
  inferAiApiSpecFromProvider,
} from '../../dist-electron/shared/ai-api-format.js'

function createConfig(overrides = {}) {
  return {
    id: 'model-1',
    name: 'Test model',
    spec: 'openai',
    provider: 'custom',
    providerName: 'Custom',
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'secret-key',
    model: 'test-model',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    reasoningEnabled: true,
    reasoningParameter: 'reasoning_effort',
    reasoningEffort: 'high',
    reasoningEffortOptions: ['low', 'medium', 'high'],
    inputModalities: ['text'],
    supportsAttachments: false,
    ...overrides,
  }
}

const messages = [
  { role: 'system', content: 'system prompt' },
  { role: 'user', content: 'hello' },
]
const tools = [{
  type: 'function',
  function: {
    name: 'run_shell_command',
    description: 'run command',
    parameters: { type: 'object', properties: {} },
    strict: true,
  },
}]

test('OpenAI Chat Completions 使用兼容端点、Bearer 和嵌套函数工具', () => {
  const request = createAiApiRequest(createConfig(), messages, tools)

  assert.equal(request.url, 'https://api.example.com/v1/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer secret-key')
  assert.equal(request.body.max_tokens, 8_192)
  assert.equal(request.body.reasoning_effort, 'high')
  assert.equal(request.body.tools[0].function.name, 'run_shell_command')
})

test('OpenAI Responses 使用 input、扁平工具和 reasoning.effort', () => {
  const request = createAiApiRequest(createConfig({
    spec: 'responses',
    reasoningParameter: 'reasoning.effort',
  }), messages, tools, 4_096, true)

  assert.equal(request.url, 'https://api.example.com/v1/responses')
  assert.equal(request.body.max_output_tokens, 4_096)
  assert.equal(request.body.stream, true)
  assert.equal(request.body.reasoning.effort, 'high')
  assert.equal(request.body.tools[0].name, 'run_shell_command')
  assert.equal(request.body.input[0].role, 'system')
})

test('Anthropic Messages 使用 x-api-key、input_schema 和真实思考字段', () => {
  const request = createAiApiRequest(createConfig({
    spec: 'anthropic',
    reasoningParameter: 'output_config.effort',
  }), messages, tools)

  assert.equal(request.url, 'https://api.example.com/v1/messages')
  assert.equal(request.headers['x-api-key'], 'secret-key')
  assert.equal(request.headers['anthropic-version'], '2023-06-01')
  assert.equal(request.body.system, 'system prompt')
  assert.equal(request.body.tools[0].input_schema.type, 'object')
  assert.equal(request.body.output_config.effort, 'high')
  assert.deepEqual(request.body.thinking, { type: 'adaptive' })
})

test('Anthropic token budget 会作为数字发送且摘要请求可关闭推理', () => {
  const config = createConfig({
    spec: 'anthropic',
    reasoningParameter: 'thinking.budget_tokens',
    reasoningEffort: '4096',
  })
  const request = createAiApiRequest(config, messages, [], 8_192)
  const summaryRequest = createAiApiRequest(config, messages, [], 4_096, false, false)

  assert.deepEqual(request.body.thinking, { budget_tokens: 4_096, type: 'enabled' })
  assert.equal(summaryRequest.body.thinking, undefined)
})

test('models.dev 厂商格式与推理选项会生成可修改的默认值', () => {
  assert.equal(inferAiApiSpecFromProvider('openai', '@ai-sdk/openai'), 'responses')
  assert.equal(inferAiApiSpecFromProvider('anthropic', '@ai-sdk/anthropic'), 'anthropic')
  assert.equal(inferAiApiSpecFromProvider('custom', '@ai-sdk/openai-compatible'), 'openai')

  assert.deepEqual(
    getAiReasoningDefaults('responses', [{ type: 'effort', values: ['minimal', 'high'] }], true),
    {
      enabled: true,
      parameter: 'reasoning.effort',
      effort: 'minimal',
      options: ['minimal', 'high'],
    },
  )
  assert.deepEqual(
    getAiReasoningDefaults(
      'anthropic',
      [{ type: 'budget_tokens', min: 2_048, max: 16_384 }],
      true,
      8_192,
    ),
    {
      enabled: true,
      parameter: 'thinking.budget_tokens',
      effort: '4096',
      options: ['2048', '4096', '8192'],
    },
  )
})

test('三种非流式响应都能提取文本与工具调用', () => {
  const chat = parseAiApiResponsePayload('openai', {
    choices: [{ message: { content: 'chat', tool_calls: [] } }],
  })
  const anthropic = parseAiApiResponsePayload('anthropic', {
    content: [
      { type: 'text', text: 'anthropic' },
      { type: 'tool_use', id: 'tool-1', name: 'run_shell_command', input: { command: 'pwd' } },
    ],
  })
  const responses = parseAiApiResponsePayload('responses', {
    output: [
      { type: 'message', content: [{ type: 'output_text', text: 'responses' }] },
      { type: 'function_call', call_id: 'call-1', name: 'run_shell_command', arguments: '{"command":"pwd"}' },
    ],
  })

  assert.equal(chat.contentText, 'chat')
  assert.equal(anthropic.contentText, 'anthropic')
  assert.deepEqual(anthropic.toolCalls[0].function.arguments, { command: 'pwd' })
  assert.equal(responses.contentText, 'responses')
  assert.equal(responses.toolCalls[0].function.name, 'run_shell_command')
})

test('Anthropic 与 Responses 推理内容按 SSE 分片实时转发', async () => {
  const encoder = new TextEncoder()
  const makeBody = chunks => new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
  const anthropicChunks = []
  const anthropic = await collectAiApiStream('anthropic', makeBody([
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"分析"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"完成"}}\n\n',
  ]), text => anthropicChunks.push(text))
  const responsesChunks = []
  const responses = await collectAiApiStream('responses', makeBody([
    'data: {"type":"response.reasoning_summary_text.delta","delta":"检查"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"完成"}\n\n',
  ]), text => responsesChunks.push(text))

  assert.equal(anthropic.contentText, '分析完成')
  assert.deepEqual(anthropicChunks, ['分析', '完成'])
  assert.equal(responses.contentText, '检查完成')
  assert.deepEqual(responsesChunks, ['检查', '完成'])
})
