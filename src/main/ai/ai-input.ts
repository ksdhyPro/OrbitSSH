import type {
  AiApprovedCommandInput,
  AiAttachment,
  AiCancelInput,
  AiChatInput,
  AiConversationCompaction,
  AiMessage,
  AiRejectedCommandInput,
} from "../../shared/ai.js";
import {
  DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB,
  MAX_AI_ATTACHMENT_COUNT,
  MAX_AI_ATTACHMENT_SIZE_MB,
  isAiTextAttachment,
  type AiAttachmentDelivery,
} from "../../shared/ai.js";

const maxMessageChars = 8_000;
const maxHistoryCount = 200;
const maxHistoryChars = 1_200_000;
const maxCompactionChars = 32_000;
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

function normalizeAttachments(
  value: unknown,
  maxAttachmentSizeMb: number,
): AiAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_AI_ATTACHMENT_COUNT) {
    throw new Error(`AI 附件最多允许 ${MAX_AI_ATTACHMENT_COUNT} 个`);
  }

  const normalizedMaxMb = Number.isFinite(maxAttachmentSizeMb)
    ? Math.min(
        MAX_AI_ATTACHMENT_SIZE_MB,
        Math.max(1, Math.floor(maxAttachmentSizeMb)),
      )
    : DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB;
  const maxAttachmentBytes = normalizedMaxMb * 1024 * 1024;
  const maxAttachmentDataUrlChars = Math.ceil(maxAttachmentBytes * 4 / 3) + 1024;

  return value.map((item, index) => {
    const record = requireRecord(item, `AI 附件第 ${index + 1} 个`);
    const name = requireBoundedString(record.name, "AI 附件名称", 256);
    const mimeType = requireBoundedString(record.mimeType, "AI 附件类型", 128);
    if (
      typeof record.dataUrl !== "string" ||
      !record.dataUrl ||
      record.dataUrl.length > maxAttachmentDataUrlChars
    ) {
      throw new Error(`AI 附件数据不能超过 ${maxAttachmentDataUrlChars} 个字符`);
    }
    const dataUrl = record.dataUrl;
    const size = Number(record.size);
    if (!Number.isInteger(size) || size < 1 || size > maxAttachmentBytes) {
      throw new Error(`AI 附件大小不能超过 ${normalizedMaxMb} MB`);
    }
    if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
      throw new Error("AI 附件数据格式无效");
    }
    const delivery: AiAttachmentDelivery =
      record.delivery === "chunked" ? "chunked" : "inline";
    if (delivery === "chunked" && !isAiTextAttachment({ name, mimeType })) {
      throw new Error("只有文本、代码、配置和日志附件可以分段读取");
    }
    const id =
      typeof record.id === "string" && record.id.trim()
        ? requireBoundedString(record.id, "AI 附件 ID", 128)
        : `attachment-${index + 1}`;
    return { id, name, mimeType, size, dataUrl, delivery };
  });
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

function normalizeHistory(value: unknown): AiMessage[] {
  if (!Array.isArray(value)) throw new Error("AI 对话历史必须是数组");
  if (value.length > maxHistoryCount) {
    throw new Error(`AI 对话历史不能超过 ${maxHistoryCount} 条`);
  }
  let totalChars = 0;
  return value.map((item, index) => {
    const record = requireRecord(item, `AI 对话历史第 ${index + 1} 条`);
    const content = requireBoundedString(
      record.content,
      `AI 对话历史第 ${index + 1} 条内容`,
      maxMessageChars,
    );
    totalChars += content.length;
    if (totalChars > maxHistoryChars) {
      throw new Error(`AI 对话历史总长度不能超过 ${maxHistoryChars} 个字符`);
    }
    const createdAt = Number(record.createdAt);
    const completedAt =
      record.completedAt === undefined ? undefined : Number(record.completedAt);
    if (!Number.isFinite(createdAt)) throw new Error("AI 消息创建时间无效");
    if (completedAt !== undefined && !Number.isFinite(completedAt)) {
      throw new Error("AI 消息完成时间无效");
    }
    return {
      id: requireBoundedString(record.id, "AI 消息 ID", 128),
      role: requireEnum(record.role, "AI 消息角色", ["user", "assistant"] as const),
      content,
      createdAt,
      completedAt,
    } satisfies AiMessage;
  });
}

function normalizeCompaction(value: unknown): AiConversationCompaction | undefined {
  if (value === undefined || value === null) return undefined;
  const record = requireRecord(value, "AI 对话摘要");
  const coveredThroughCreatedAt = Number(record.coveredThroughCreatedAt);
  const updatedAt = Number(record.updatedAt);
  if (!Number.isFinite(coveredThroughCreatedAt) || !Number.isFinite(updatedAt)) {
    throw new Error("AI 对话摘要时间无效");
  }
  return {
    content: requireBoundedString(record.content, "AI 对话摘要内容", maxCompactionChars),
    coveredThroughMessageId: requireBoundedString(
      record.coveredThroughMessageId,
      "AI 对话摘要消息 ID",
      128,
    ),
    coveredThroughCreatedAt,
    updatedAt,
  };
}

export function normalizeAiChatInput(
  input: unknown,
  maxAttachmentSizeMb = DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB,
): AiChatInput {
  const record = requireRecord(input, "AI 对话参数");
  const tabId = requireBoundedString(record.tabId, "终端标签页 ID", 128);
  const conversationId = requireBoundedString(
    record.conversationId,
    "AI 会话 ID",
    128,
  );
  const context = requireRecord(record.context, "AI 上下文");
  const contextTabId = requireBoundedString(context.tabId, "AI 上下文标签页 ID", 128);
  if (contextTabId !== tabId) throw new Error("AI 上下文标签页与当前标签页不匹配");
  const attachments = normalizeAttachments(record.attachments, maxAttachmentSizeMb);
  const rawMessage = typeof record.message === "string" ? record.message.trim() : "";
  if (rawMessage.length > maxMessageChars) {
    throw new Error(`AI 消息不能超过 ${maxMessageChars} 个字符`);
  }
  if (!rawMessage && attachments.length === 0) {
    throw new Error("AI 消息或附件不能为空");
  }
  return {
    tabId,
    conversationId,
    mode: requireEnum(record.mode, "AI 模式", ["ask", "full"] as const),
    message: rawMessage || "请分析这些附件",
    context: {
      tabId: contextTabId,
      serverId: normalizeOptionalBoundedString(context.serverId, "服务器 ID", 128),
      serverName: normalizeOptionalBoundedString(context.serverName, "服务器名称", 512),
      currentPath: normalizeOptionalBoundedString(context.currentPath, "当前路径", 4_096),
      status: normalizeOptionalBoundedString(context.status, "连接状态", 128),
      sftpPath: normalizeOptionalBoundedString(context.sftpPath, "SFTP 路径", 4_096),
    },
    history: normalizeHistory(record.history),
    compaction: normalizeCompaction(record.compaction),
    attachments,
  };
}

export function normalizeApprovedCommandInput(input: unknown): AiApprovedCommandInput {
  const record = requireRecord(input, "AI 授权命令参数");
  return {
    tabId: requireBoundedString(record.tabId, "终端标签页 ID", 128),
    conversationId: requireBoundedString(record.conversationId, "AI 会话 ID", 128),
    command: requireBoundedString(record.command, "授权命令", maxCommandChars),
    approvalId: requireBoundedString(record.approvalId, "授权 ID", 128),
  };
}

export function normalizeRejectedApprovalInput(input: unknown): AiRejectedCommandInput {
  const record = requireRecord(input, "拒绝授权参数");
  return {
    tabId: requireBoundedString(record.tabId, "终端标签页 ID", 128),
    conversationId: requireBoundedString(record.conversationId, "AI 会话 ID", 128),
    approvalId: requireBoundedString(record.approvalId, "授权 ID", 128),
  };
}

export function normalizeAiCancelInput(input: unknown): AiCancelInput {
  const record = requireRecord(input, "AI 取消参数");
  return {
    tabId: requireBoundedString(record.tabId, "终端标签页 ID", 128),
    conversationId: requireBoundedString(record.conversationId, "AI 会话 ID", 128),
  };
}
