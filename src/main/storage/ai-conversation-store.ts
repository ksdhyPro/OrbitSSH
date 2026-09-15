import Store from 'electron-store'

import type {
  AiCommandCard,
  AiCommandResult,
  AiConversationRecord,
  AiConversationSummary,
  AiMessage,
  AiSaveConversationInput
} from '../../shared/ai.js'

interface AiConversationStoreSchema {
  conversationsByServer: Record<string, AiConversationRecord[]>
}

// 每台服务器最多保留的历史对话数，超出时按 updatedAt 淘汰最旧的。
const MAX_CONVERSATIONS_PER_SERVER = 50
// 单条命令输出持久化上限（字符），保留尾部以留住错误信息，避免撑爆本地配置。
const MAX_COMMAND_OUTPUT_LENGTH = 20_000

const store = new Store<AiConversationStoreSchema>({
  name: 'ai-conversations',
  defaults: {
    conversationsByServer: {}
  }
})

function getConversationsByServer(): Record<string, AiConversationRecord[]> {
  return store.get('conversationsByServer', {})
}

function saveConversationsByServer(map: Record<string, AiConversationRecord[]>): void {
  store.set('conversationsByServer', map)
}

function normalizeServerId(serverId: unknown): string {
  if (typeof serverId !== 'string' || !serverId.trim()) {
    throw new Error('服务器 ID 无效')
  }
  return serverId.trim()
}

// 应用重启后原会话里的运行中命令早已不存在，读取时统一归一化为已终止。
const STALE_COMMAND_STATUSES: ReadonlySet<string> = new Set(['running', 'pending', 'requires_approval'])

function normalizeCommandOutput(text: unknown): string | undefined {
  if (typeof text !== 'string' || !text) return undefined
  if (text.length <= MAX_COMMAND_OUTPUT_LENGTH) return text
  const truncated = text.slice(text.length - MAX_COMMAND_OUTPUT_LENGTH)
  return `…(输出过长，已截断)\n${truncated}`
}

function normalizeCommandResult(result: AiCommandResult | undefined): AiCommandResult | undefined {
  if (!result) return undefined
  return {
    ...result,
    stdout: normalizeCommandOutput(result.stdout) ?? '',
    stderr: normalizeCommandOutput(result.stderr) ?? ''
  }
}

function normalizeCommandCard(card: AiCommandCard): AiCommandCard {
  return {
    ...card,
    status: STALE_COMMAND_STATUSES.has(card.status) ? 'cancelled' : card.status,
    result: normalizeCommandResult(card.result),
    error: normalizeCommandOutput(card.error)
  }
}

function normalizeConversation(conversation: AiConversationRecord): AiConversationRecord {
  return {
    ...conversation,
    messages: conversation.messages ?? [],
    commandCards: (conversation.commandCards ?? []).map(card => normalizeCommandCard(card))
  }
}

function toSummary(conversation: AiConversationRecord): AiConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
  }
}

/** 校验并归一化保存输入，拒绝缺少必要字段的记录进入本地存储。 */
function normalizeSaveInput(input: AiSaveConversationInput): AiSaveConversationInput {
  const serverId = normalizeServerId(input?.serverId)
  const conversation = input?.conversation

  if (
    !conversation ||
    typeof conversation !== 'object' ||
    typeof conversation.id !== 'string' ||
    !conversation.id.trim() ||
    !Array.isArray(conversation.messages) ||
    !Array.isArray(conversation.commandCards)
  ) {
    throw new Error('对话数据无效')
  }

  return {
    serverId,
    conversation: {
      ...conversation,
      id: conversation.id.trim(),
      title: typeof conversation.title === 'string' && conversation.title.trim()
        ? conversation.title.trim()
        : '新对话'
    }
  }
}

export function listConversationSummaries(serverId: string): AiConversationSummary[] {
  const normalizedServerId = normalizeServerId(serverId)
  return (getConversationsByServer()[normalizedServerId] ?? [])
    .map(conversation => toSummary(normalizeConversation(conversation)))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function getConversationRecord(serverId: string, conversationId: string): AiConversationRecord | null {
  const normalizedServerId = normalizeServerId(serverId)
  const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!normalizedConversationId) throw new Error('对话 ID 无效')

  const conversation = (getConversationsByServer()[normalizedServerId] ?? [])
    .find(item => item.id === normalizedConversationId)

  return conversation ? normalizeConversation(conversation) : null
}

export function saveConversation(input: AiSaveConversationInput): boolean {
  const { serverId, conversation } = normalizeSaveInput(input)

  // 空对话（刚点“新对话”还没发过消息）不落盘，避免历史列表充满空条目。
  if (conversation.messages.length === 0) {
    return false
  }

  const map = getConversationsByServer()
  const conversations = map[serverId] ?? []
  const index = conversations.findIndex(item => item.id === conversation.id)
  const record = normalizeConversation(conversation)

  if (index >= 0) {
    conversations[index] = record
  } else {
    conversations.push(record)
  }

  map[serverId] = conversations
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CONVERSATIONS_PER_SERVER)
  saveConversationsByServer(map)
  return true
}

export function deleteConversation(serverId: string, conversationId: string): boolean {
  const normalizedServerId = normalizeServerId(serverId)
  const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!normalizedConversationId) throw new Error('对话 ID 无效')

  const map = getConversationsByServer()
  const conversations = map[normalizedServerId] ?? []
  const next = conversations.filter(item => item.id !== normalizedConversationId)

  if (next.length === conversations.length) {
    return false
  }

  if (next.length === 0) {
    delete map[normalizedServerId]
  } else {
    map[normalizedServerId] = next
  }
  saveConversationsByServer(map)
  return true
}

/** 删除服务器时级联清理其全部 AI 历史对话，避免本地配置残留。 */
export function deleteConversationsByServer(serverId: string): void {
  const normalizedServerId = normalizeServerId(serverId)
  const map = getConversationsByServer()

  if (!(normalizedServerId in map)) {
    return
  }

  delete map[normalizedServerId]
  saveConversationsByServer(map)
}
