export type AiMode = "ask" | "auto" | "full";

export type AiMessageRole = "user" | "assistant" | "system";

export type AiCommandStatus =
  | "suggested"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "requires_approval"
  | "rejected";

export interface AiMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  createdAt: number;
}

export interface AiCommandCard {
  id: string;
  tabId: string;
  command: string;
  reason: string;
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
  decision: "allow_readonly" | "requires_approval" | "deny";
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
  command: string;
  approvalId: string;
}

export interface AiRejectedCommandInput {
  approvalId: string;
}

export interface AiCancelInput {
  tabId: string;
}

export interface AiStreamChunkEvent {
  tabId: string;
  // 标识当前 chunk 属于哪条流式消息，前端据此把文本累加到对应占位消息。
  messageId: string;
  chunk: string;
}

// 每轮 AI 回复开始时推送一次：前端立即插入一条空占位 assistant 消息，
// 后续 AiStreamChunkEvent 携带相同 messageId 把文本累加到该占位上。
export interface AiStreamMessageStartEvent {
  tabId: string;
  messageId: string;
  createdAt: number;
}

// 命令卡片状态变迁（running/completed/failed/requires_approval/rejected）的实时推送。
// payload 是完整 AiCommandCard，前端按 id 做 upsert。
export interface AiCommandCardEvent {
  tabId: string;
  card: AiCommandCard;
}
