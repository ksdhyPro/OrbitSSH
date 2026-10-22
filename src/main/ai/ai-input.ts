import type {
  AiApprovedCommandInput,
  AiCancelInput,
  AiChatInput,
  AiMessage,
  AiRejectedCommandInput,
} from "../../shared/ai.js";
import { AI_PRESET_PROMPT_MAX_CHARS } from "../../shared/settings.js";

const maxMessageChars = 8_000;
const maxHistoryCount = 500;
const maxHistoryChars = 1_000_000;
const maxCommandChars = 4_096;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireBoundedString(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}不能为空`);
  }
  const text = value.trim();
  if (text.length > maxChars) throw new Error(`${label}不能超过 ${maxChars} 个字符`);
  return text;
}

function normalizeOptionalBoundedString(
  value: unknown,
  label: string,
  maxChars: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireBoundedString(value, label, maxChars);
}

function normalizeBoundedString(value: unknown, label: string, maxChars: number): string {
  if (value === undefined || value === null || value === "") return "";
  return requireBoundedString(value, label, maxChars);
}

function requireEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label}不在允许范围内`);
  }
  return value as T;
}

const truncatedHistoryMarker = "\n…[历史消息过长，已截断]";

function truncateHistoryContent(content: string): string {
  return content.length > maxMessageChars
    ? `${content.slice(0, maxMessageChars - truncatedHistoryMarker.length)}${truncatedHistoryMarker}`
    : content;
}

/**
 * 历史消息是已经发生的对话，长度超限时截断或丢弃最早的消息，不能让单条长回复
 * （例如完整的排查报告）导致该对话之后的所有请求都被拒绝。结构非法的消息仍然拒绝。
 */
function normalizeHistory(value: unknown): AiMessage[] {
  if (!Array.isArray(value)) throw new Error("AI 对话历史必须是数组");

  const messages = value.map((item, index): AiMessage | null => {
    const record = requireRecord(item, `AI 对话历史第 ${index + 1} 条`);
    const createdAt = Number(record.createdAt);
    const completedAt =
      record.completedAt === undefined ? undefined : Number(record.completedAt);
    if (!Number.isFinite(createdAt)) throw new Error("AI 消息创建时间无效");
    if (completedAt !== undefined && !Number.isFinite(completedAt)) {
      throw new Error("AI 消息完成时间无效");
    }
    const id = requireBoundedString(record.id, "AI 消息 ID", 128);
    const role = requireEnum(record.role, "AI 消息角色", ["user", "assistant"] as const);
    if (typeof record.content !== "string") {
      throw new Error(`AI 对话历史第 ${index + 1} 条内容必须是字符串`);
    }
    const content = record.content.trim();
    // 流式占位等空消息对模型没有意义，直接跳过。
    if (!content) return null;
    return { id, role, content: truncateHistoryContent(content), createdAt, completedAt };
  });

  // 从最新消息往前保留，超出条数或总长度时丢弃最早的消息。
  const kept: AiMessage[] = [];
  let totalChars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (kept.length >= maxHistoryCount || totalChars + message.content.length > maxHistoryChars) break;
    totalChars += message.content.length;
    kept.unshift(message);
  }
  return kept;
}

export function normalizeAiChatInput(input: unknown): AiChatInput {
  const record = requireRecord(input, "AI 对话参数");
  const tabId = requireBoundedString(record.tabId, "终端标签页 ID", 128);
  const context = requireRecord(record.context, "AI 上下文");
  const contextTabId = requireBoundedString(context.tabId, "AI 上下文标签页 ID", 128);
  if (contextTabId !== tabId) throw new Error("AI 上下文标签页与当前标签页不匹配");
  const conversationCreatedAt = Number(record.conversationCreatedAt);
  const messageCreatedAt = Number(record.messageCreatedAt);
  if (!Number.isFinite(conversationCreatedAt) || !Number.isFinite(messageCreatedAt)) {
    throw new Error("AI 对话时间无效");
  }
  return {
    tabId,
    requestId: requireBoundedString(record.requestId, "AI 请求 ID", 128),
    conversationId: requireBoundedString(record.conversationId, "AI 对话 ID", 128),
    mode: requireEnum(
      record.mode,
      "AI 模式",
      ["ask", "auto", "full_access"] as const,
    ),
    presetPrompt: normalizeBoundedString(
      record.presetPrompt,
      "AI 预提示词",
      AI_PRESET_PROMPT_MAX_CHARS,
    ),
    conversationTitle: requireBoundedString(
      record.conversationTitle,
      "AI 对话标题",
      128,
    ),
    conversationCreatedAt,
    messageId: requireBoundedString(record.messageId, "AI 当前消息 ID", 128),
    messageCreatedAt,
    message: requireBoundedString(record.message, "AI 消息", maxMessageChars),
    context: {
      tabId: contextTabId,
      serverId: requireBoundedString(context.serverId, "服务器 ID", 128),
      serverName: normalizeOptionalBoundedString(context.serverName, "服务器名称", 512),
      currentPath: normalizeOptionalBoundedString(context.currentPath, "当前路径", 4_096),
      status: normalizeOptionalBoundedString(context.status, "连接状态", 128),
      sftpPath: normalizeOptionalBoundedString(context.sftpPath, "SFTP 路径", 4_096),
    },
    history: normalizeHistory(record.history),
  };
}

export function normalizeApprovedCommandInput(input: unknown): AiApprovedCommandInput {
  const record = requireRecord(input, "AI 授权命令参数");
  return {
    tabId: requireBoundedString(record.tabId, "终端标签页 ID", 128),
    requestId: requireBoundedString(record.requestId, "AI 请求 ID", 128),
    conversationId: requireBoundedString(record.conversationId, "AI 对话 ID", 128),
    command: requireBoundedString(record.command, "授权命令", maxCommandChars),
    approvalId: requireBoundedString(record.approvalId, "授权 ID", 128),
  };
}

export function normalizeRejectedApprovalInput(input: unknown): AiRejectedCommandInput {
  const record = requireRecord(input, "拒绝授权参数");
  return {
    tabId: requireBoundedString(record.tabId, "终端标签页 ID", 128),
    conversationId: requireBoundedString(record.conversationId, "AI 对话 ID", 128),
    approvalId: requireBoundedString(record.approvalId, "授权 ID", 128),
  };
}

export function normalizeAiCancelInput(input: unknown): AiCancelInput {
  const record = requireRecord(input, "AI 取消参数");
  return {
    tabId: requireBoundedString(record.tabId, "终端标签页 ID", 128),
    requestId: requireBoundedString(record.requestId, "AI 请求 ID", 128),
  };
}
