export type AiMode = "ask" | "full";

export const DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB = 8;
export const MAX_AI_ATTACHMENT_SIZE_MB = 64;
export const MAX_AI_ATTACHMENT_COUNT = 4;
export const AI_TEXT_ATTACHMENT_CHUNK_THRESHOLD_BYTES = 1024 * 1024;
export const AI_ATTACHMENT_CHUNK_MAX_BYTES = 32 * 1024;

export type AiAttachmentDelivery = "inline" | "chunked";

const AI_TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/xml",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-ndjson",
  "application/x-sh",
  "application/x-yaml",
]);

const AI_TEXT_FILE_EXTENSIONS = new Set([
  "bash", "bat", "c", "cc", "cfg", "cjs", "conf", "cpp", "cs", "css",
  "csv", "dart", "env", "fish", "go", "gql", "graphql", "gradle", "groovy",
  "h", "hpp", "htm", "html", "ini", "java", "js", "json", "jsonl", "jsx",
  "kt", "kts", "less", "log", "lua", "md", "mjs", "php", "pl", "properties",
  "proto", "ps1", "py", "r", "rb", "rs", "sass", "scala", "scss", "sh",
  "sql", "swift", "toml", "ts", "tsv", "tsx", "txt", "vue", "xml", "yaml",
  "yml", "zsh",
]);

export function isAiTextAttachment(
  attachment: Pick<AiAttachment, "name" | "mimeType">,
): boolean {
  const mimeType = attachment.mimeType.trim().toLowerCase();
  if (mimeType.startsWith("text/") || AI_TEXT_MIME_TYPES.has(mimeType)) return true;
  if (mimeType.endsWith("+json") || mimeType.endsWith("+xml")) return true;
  const normalizedName = attachment.name.trim().toLowerCase();
  if (normalizedName === "dockerfile" || normalizedName === ".gitignore") return true;
  const extension = normalizedName.split(".").pop() ?? "";
  return AI_TEXT_FILE_EXTENSIONS.has(extension);
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
  attachments?: AiMessageAttachment[];
}

export interface AiMessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  delivery?: AiAttachmentDelivery;
  /** 正文存入 IndexedDB；历史索引只持久化其余轻量字段。 */
  dataUrl?: string;
}

export interface AiConversationSummary {
  id: string
  title: string
  serverId: string
  serverName: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface AiConversationCompaction {
  /** 模型生成的滚动语义摘要。 */
  content: string;
  /** 摘要覆盖到的最后一条原始消息，便于后续只发送增量历史。 */
  coveredThroughMessageId: string;
  coveredThroughCreatedAt: number;
  updatedAt: number;
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
  decision: "allow_readonly" | "allow_full" | "requires_approval" | "deny";
  reason: string;
}

export interface AiContextInput {
  tabId: string;
  serverId?: string;
  serverName?: string;
  currentPath?: string;
  status?: string;
  sftpPath?: string;
}

export interface AiAttachment {
  id?: string
  name: string
  mimeType: string
  size: number
  dataUrl: string
  delivery?: AiAttachmentDelivery
}

export interface AiAttachmentReadRequest {
  attachmentId: string
  offset: number
  maxBytes: number
}

export interface AiAttachmentReadResult {
  attachmentId: string
  name: string
  offset: number
  nextOffset: number
  totalBytes: number
  content: string
  eof: boolean
}

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export interface AiChatInput {
  tabId: string;
  conversationId: string;
  mode: AiMode;
  message: string;
  context: AiContextInput;
  history: AiMessage[];
  compaction?: AiConversationCompaction;
  attachments?: AiAttachment[];
}

export interface AiChatResult {
  // 主进程把 agent loop 每一轮的 AI 回复作为独立消息返回，前端用于和流式占位对账。
  messages: AiMessage[];
  commandCards: AiCommandCard[];
  compaction?: AiConversationCompaction;
}

export interface AiApprovedCommandInput {
  tabId: string;
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
  conversationId: string;
}

export interface AiStreamChunkEvent {
  tabId: string;
  conversationId: string;
  // 标识当前 chunk 属于哪条流式消息，前端据此把文本累加到对应占位消息。
  messageId: string;
  chunk: string;
}

// 每轮 AI 回复开始时推送一次：前端立即插入一条空占位 assistant 消息，
// 后续 AiStreamChunkEvent 携带相同 messageId 把文本累加到该占位上。
export interface AiStreamMessageStartEvent {
  tabId: string;
  conversationId: string;
  messageId: string;
  createdAt: number;
}

// 命令卡片状态变迁（running/completed/failed/requires_approval/rejected）的实时推送。
// payload 是完整 AiCommandCard，前端按 id 做 upsert。
export interface AiCommandCardEvent {
  tabId: string;
  conversationId: string;
  card: AiCommandCard;
}
