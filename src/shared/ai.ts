export type AiMode = "suggest" | "readonly" | "approval";

export type AiMessageRole = "user" | "assistant" | "system";

export type AiCommandStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "requires_approval";

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
  message: AiMessage;
  commandCards: AiCommandCard[];
}

export interface AiCommandApprovalInput {
  tabId: string;
  command: string;
  reason: string;
  risk: AiCommandCard["risk"];
}

export interface AiApprovedCommandInput {
  tabId: string;
  command: string;
  approvalId: string;
}
