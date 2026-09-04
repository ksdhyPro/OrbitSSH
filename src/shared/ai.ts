/** AI 命令权限：逐条审批、自主执行、完全访问。 */
export type AiMode = "ask" | "auto" | "full_access";

/** 归一化持久化权限值，并安全迁移旧版“自动只读”的 full。 */
export function normalizeStoredAiMode(value: unknown): AiMode {
  if (value === "ask" || value === "auto" || value === "full_access") {
    return value;
  }
  if (value === "full" || value === "autonomous" || value === "readonly") {
    return "auto";
  }
  if (value === "suggest" || value === "approval") {
    return "ask";
  }
  if (value === "unrestricted" || value === "danger-full-access") {
    return "full_access";
  }
  return "auto";
}

export type AiMessageRole = "user" | "assistant" | "system";

export type AiCommandStatus =
  | "suggested"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "requires_approval"
  | "rejected";

export interface AiMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  createdAt: number;
  completedAt?: number;
}

export interface AiCommandCard {
  id: string;
  tabId: string;
  conversationId: string;
  command: string;
  reason: string;
  /** 命令实际绑定的执行目录；跨服务器查询未指定目录时为空。 */
  workingDirectory?: string;
  risk: "low" | "medium" | "high";
  status: AiCommandStatus;
  createdAt: number;
  approvalId?: string;
  result?: AiCommandResult;
  error?: string;
}

export interface AiCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface AiCommandPolicyResult {
  decision:
    | "allow_readonly"
    | "allow_autonomous"
    | "requires_approval"
    | "deny";
  reason: string;
}

export interface AiContextInput {
  tabId: string;
  serverName?: string;
  currentPath?: string;
  status?: string;
  sftpPath?: string;
}

export interface AiChatInput {
  tabId: string;
  requestId: string;
  conversationId: string;
  mode: AiMode;
  message: string;
  context: AiContextInput;
  history: AiMessage[];
}

export interface AiChatResult {
  // 主进程把 agent loop 每一轮的 AI 回复作为独立消息返回，前端用于和流式占位对账。
  messages: AiMessage[];
  commandCards: AiCommandCard[];
}

export interface AiApprovedCommandInput {
  tabId: string;
  requestId: string;
  conversationId: string;
  command: string;
  approvalId: string;
}

export interface AiRejectedCommandInput {
  tabId: string;
  conversationId: string;
  approvalId: string;
}

export interface AiCancelInput {
  tabId: string;
  requestId: string;
}

export interface AiStreamChunkEvent {
  tabId: string;
  requestId: string;
  conversationId: string;
  // 标识当前 chunk 属于哪条流式消息，前端据此把文本累加到对应占位消息。
  messageId: string;
  chunk: string;
}

// 每轮 AI 回复开始时推送一次：前端立即插入一条空占位 assistant 消息，
// 后续 AiStreamChunkEvent 携带相同 messageId 把文本累加到该占位上。
export interface AiStreamMessageStartEvent {
  tabId: string;
  requestId: string;
  conversationId: string;
  messageId: string;
  createdAt: number;
}

// 命令卡片状态变迁（running/completed/failed/requires_approval/rejected）的实时推送。
// payload 是完整 AiCommandCard，前端按 id 做 upsert。
export interface AiCommandCardEvent {
  tabId: string;
  requestId: string;
  conversationId: string;
  card: AiCommandCard;
}
