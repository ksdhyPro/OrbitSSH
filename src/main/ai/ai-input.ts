import type {
  AiApprovedCommandInput,
  AiChatInput,
  AiMessage,
  AiRejectedCommandInput,
} from "../../shared/ai.js";

const maxMessageChars = 8_000;
const maxHistoryCount = 24;
const maxHistoryChars = 64_000;
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

export function normalizeAiChatInput(input: unknown): AiChatInput {
  const record = requireRecord(input, "AI 对话参数");
  const tabId = requireBoundedString(record.tabId, "终端标签页 ID", 128);
  const context = requireRecord(record.context, "AI 上下文");
  const contextTabId = requireBoundedString(context.tabId, "AI 上下文标签页 ID", 128);
  if (contextTabId !== tabId) throw new Error("AI 上下文标签页与当前标签页不匹配");
  return {
    tabId,
    mode: requireEnum(record.mode, "AI 模式", ["ask", "full"] as const),
    message: requireBoundedString(record.message, "AI 消息", maxMessageChars),
    context: {
      tabId: contextTabId,
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
    command: requireBoundedString(record.command, "授权命令", maxCommandChars),
    approvalId: requireBoundedString(record.approvalId, "授权 ID", 128),
  };
}

export function normalizeRejectedApprovalInput(input: unknown): AiRejectedCommandInput {
  const record = requireRecord(input, "拒绝授权参数");
  return {
    tabId: requireBoundedString(record.tabId, "终端标签页 ID", 128),
    approvalId: requireBoundedString(record.approvalId, "授权 ID", 128),
  };
}
