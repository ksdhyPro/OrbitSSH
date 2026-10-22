import type {
  AiCommandCard,
  AiCommandResult,
  AiConversationRecord,
  AiConversationSummary,
} from "../../shared/ai.js";
import type { ExecutedAiCommandContext } from "../ai/ai-context.js";
import type { CachedStore } from "./cached-store.js";

export interface AiPersistedConversationContext {
  summary: string;
  commands: ExecutedAiCommandContext[];
  historyFloorCreatedAt: number;
}

export interface AiSaveConversationInput {
  serverId: string;
  conversation: AiConversationRecord;
}

export interface AiConversationStoreSchema {
  conversationsByServer: Record<string, AiConversationRecord[]>;
  runtimeContextsByServer: Record<string, Record<string, AiPersistedConversationContext>>;
}

// 每台服务器最多保留的历史对话数，超出时按 updatedAt 淘汰最旧的。
export const MAX_CONVERSATIONS_PER_SERVER = 50;
// 单条命令输出持久化上限（字符），保留尾部以留住错误信息，避免撑爆本地配置。
const MAX_COMMAND_OUTPUT_LENGTH = 20_000;

// 应用重启后原会话里的运行中命令早已不存在，读取时统一归一化为已终止。
const STALE_COMMAND_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "pending",
  "requires_approval",
]);

function normalizeServerId(serverId: unknown): string {
  if (typeof serverId !== "string" || !serverId.trim()) {
    throw new Error("服务器 ID 无效");
  }
  return serverId.trim();
}

function normalizeConversationId(conversationId: unknown): string {
  const normalized = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!normalized) throw new Error("对话 ID 无效");
  return normalized;
}

function normalizeCommandOutput(text: unknown): string | undefined {
  if (typeof text !== "string" || !text) return undefined;
  if (text.length <= MAX_COMMAND_OUTPUT_LENGTH) return text;
  const truncated = text.slice(text.length - MAX_COMMAND_OUTPUT_LENGTH);
  return `…(输出过长，已截断)\n${truncated}`;
}

function normalizeCommandResult(result: AiCommandResult | undefined): AiCommandResult | undefined {
  if (!result) return undefined;
  return {
    ...result,
    stdout: normalizeCommandOutput(result.stdout) ?? "",
    stderr: normalizeCommandOutput(result.stderr) ?? "",
  };
}

function normalizeCommandCard(card: AiCommandCard): AiCommandCard {
  return {
    ...card,
    status: STALE_COMMAND_STATUSES.has(card.status) ? "cancelled" : card.status,
    result: normalizeCommandResult(card.result),
    error: normalizeCommandOutput(card.error),
  };
}

function normalizeConversation(conversation: AiConversationRecord): AiConversationRecord {
  return {
    ...conversation,
    messages: conversation.messages ?? [],
    commandCards: (conversation.commandCards ?? []).map(card => normalizeCommandCard(card)),
  };
}

function toSummary(conversation: AiConversationRecord): AiConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages?.length ?? 0,
  };
}

/** 校验并归一化保存输入，拒绝缺少必要字段的记录进入本地存储。 */
function normalizeSaveInput(input: AiSaveConversationInput): AiSaveConversationInput {
  const serverId = normalizeServerId(input?.serverId);
  const conversation = input?.conversation;

  if (
    !conversation ||
    typeof conversation !== "object" ||
    typeof conversation.id !== "string" ||
    !conversation.id.trim() ||
    !Array.isArray(conversation.messages) ||
    !Array.isArray(conversation.commandCards)
  ) {
    throw new Error("对话数据无效");
  }

  return {
    serverId,
    conversation: {
      ...conversation,
      id: conversation.id.trim(),
      title:
        typeof conversation.title === "string" && conversation.title.trim()
          ? conversation.title.trim()
          : "新对话",
    },
  };
}

function normalizeRuntimeContext(
  context: AiPersistedConversationContext,
): AiPersistedConversationContext {
  return {
    summary: typeof context.summary === "string" ? context.summary.trim() : "",
    historyFloorCreatedAt: Number.isFinite(context.historyFloorCreatedAt)
      ? Math.max(0, context.historyFloorCreatedAt)
      : 0,
    commands: Array.isArray(context.commands)
      ? context.commands.map(command => ({
          ...command,
          result: normalizeCommandResult(command.result) ?? command.result,
        }))
      : [],
  };
}

function withoutKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * AI 对话与运行上下文的读写逻辑。缓存中的数据只读共享，所有修改都以不可变方式生成新对象，
 * 避免对整份历史做深拷贝；返回给调用方的完整记录则单独拷贝，防止外部修改污染缓存。
 */
export function createAiConversationRepository(store: CachedStore<AiConversationStoreSchema>) {
  function removeRuntimeContexts(serverId: string, conversationIds: string[]): void {
    const contexts = store.read("runtimeContextsByServer");
    const serverContexts = contexts[serverId];
    if (!serverContexts || !conversationIds.some(id => id in serverContexts)) return;

    let nextServerContexts = serverContexts;
    for (const conversationId of conversationIds) {
      nextServerContexts = withoutKey(nextServerContexts, conversationId);
    }
    store.write(
      "runtimeContextsByServer",
      Object.keys(nextServerContexts).length === 0
        ? withoutKey(contexts, serverId)
        : { ...contexts, [serverId]: nextServerContexts },
    );
  }

  function listConversationSummaries(serverId: string): AiConversationSummary[] {
    const normalizedServerId = normalizeServerId(serverId);
    return (store.read("conversationsByServer")[normalizedServerId] ?? [])
      .map(conversation => toSummary(conversation))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function getConversationRecord(
    serverId: string,
    conversationId: string,
  ): AiConversationRecord | null {
    const normalizedServerId = normalizeServerId(serverId);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const conversation = (store.read("conversationsByServer")[normalizedServerId] ?? []).find(
      item => item.id === normalizedConversationId,
    );

    return conversation ? structuredClone(normalizeConversation(conversation)) : null;
  }

  function saveConversation(input: AiSaveConversationInput): boolean {
    const { serverId, conversation } = normalizeSaveInput(input);

    // 空对话（刚点“新对话”还没发过消息）不落盘，避免历史列表充满空条目。
    if (conversation.messages.length === 0) {
      return false;
    }

    const map = store.read("conversationsByServer");
    const record = structuredClone(normalizeConversation(conversation));
    const ranked = [...(map[serverId] ?? []).filter(item => item.id !== record.id), record].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
    const kept = ranked.slice(0, MAX_CONVERSATIONS_PER_SERVER);
    const evictedIds = ranked.slice(MAX_CONVERSATIONS_PER_SERVER).map(item => item.id);

    store.write("conversationsByServer", { ...map, [serverId]: kept });
    // 被淘汰的对话不再可见，其压缩摘要和命令记忆也必须一起清理，避免无限增长。
    if (evictedIds.length > 0) removeRuntimeContexts(serverId, evictedIds);
    return true;
  }

  function deleteConversation(serverId: string, conversationId: string): boolean {
    const normalizedServerId = normalizeServerId(serverId);
    const normalizedConversationId = normalizeConversationId(conversationId);

    const map = store.read("conversationsByServer");
    const conversations = map[normalizedServerId] ?? [];
    const next = conversations.filter(item => item.id !== normalizedConversationId);

    if (next.length === conversations.length) {
      return false;
    }

    store.write(
      "conversationsByServer",
      next.length === 0
        ? withoutKey(map, normalizedServerId)
        : { ...map, [normalizedServerId]: next },
    );
    removeRuntimeContexts(normalizedServerId, [normalizedConversationId]);
    return true;
  }

  /** 保存主进程 Agent 的可恢复上下文，Renderer 不直接读写该状态。 */
  function saveConversationRuntimeContext(
    serverId: string,
    conversationId: string,
    context: AiPersistedConversationContext,
  ): void {
    const normalizedServerId = normalizeServerId(serverId);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const contexts = store.read("runtimeContextsByServer");
    store.write("runtimeContextsByServer", {
      ...contexts,
      [normalizedServerId]: {
        ...(contexts[normalizedServerId] ?? {}),
        [normalizedConversationId]: structuredClone(normalizeRuntimeContext(context)),
      },
    });
  }

  function getConversationRuntimeContext(
    serverId: string,
    conversationId: string,
  ): AiPersistedConversationContext | null {
    const normalizedServerId = normalizeServerId(serverId);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const context =
      store.read("runtimeContextsByServer")[normalizedServerId]?.[normalizedConversationId];
    return context ? structuredClone(normalizeRuntimeContext(context)) : null;
  }

  function deleteConversationRuntimeContext(serverId: string, conversationId: string): void {
    removeRuntimeContexts(serverId, [conversationId]);
  }

  /** 删除服务器时级联清理其全部 AI 历史对话，避免本地配置残留。 */
  function deleteConversationsByServer(serverId: string): void {
    const normalizedServerId = normalizeServerId(serverId);
    const map = store.read("conversationsByServer");
    if (normalizedServerId in map) {
      store.write("conversationsByServer", withoutKey(map, normalizedServerId));
    }
    const runtimeMap = store.read("runtimeContextsByServer");
    if (normalizedServerId in runtimeMap) {
      store.write("runtimeContextsByServer", withoutKey(runtimeMap, normalizedServerId));
    }
  }

  /** 清理旧版本淘汰对话时遗留的运行上下文：对应对话已不存在的记录一律删除。 */
  function pruneOrphanRuntimeContexts(): number {
    const conversations = store.read("conversationsByServer");
    const contexts = store.read("runtimeContextsByServer");
    let removed = 0;
    const next: Record<string, Record<string, AiPersistedConversationContext>> = {};

    for (const [serverId, serverContexts] of Object.entries(contexts)) {
      const existingIds = new Set((conversations[serverId] ?? []).map(item => item.id));
      const kept = Object.fromEntries(
        Object.entries(serverContexts).filter(([conversationId]) =>
          existingIds.has(conversationId),
        ),
      );
      removed += Object.keys(serverContexts).length - Object.keys(kept).length;
      if (Object.keys(kept).length > 0) next[serverId] = kept;
    }

    if (removed > 0) store.write("runtimeContextsByServer", next);
    return removed;
  }

  return {
    listConversationSummaries,
    getConversationRecord,
    saveConversation,
    deleteConversation,
    saveConversationRuntimeContext,
    getConversationRuntimeContext,
    deleteConversationRuntimeContext,
    deleteConversationsByServer,
    pruneOrphanRuntimeContexts,
  };
}
