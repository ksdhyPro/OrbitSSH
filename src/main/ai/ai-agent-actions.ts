import type {
  AiChatInput,
  AiChatResult,
  AiCommandCard,
  AiCommandPolicyResult,
  AiCommandResult,
  AiMessage,
} from "../../shared/ai.js";
import { writeAppLog } from "../logger.js";
import { executeTerminalCommand } from "../ssh/session-manager.js";
import type {
  ExecutedAiCommandContext,
  LocalPolicyRejectionFeedback,
} from "./ai-context.js";
import type { AgentEmitter } from "./ai-agent-events.js";
import { resolveAiCommandPermission } from "./ai-permission-policy.js";
import type {
  ParsedAiCommand,
  ParsedAssistantResponse,
} from "./ai-provider.js";
import { executeSavedServerCommand } from "./ai-saved-server-command.js";
import { evaluateAiCommand } from "./command-policy.js";

interface EvaluatedCommand extends ParsedAiCommand {
  policy: AiCommandPolicyResult;
}

export type EvaluatedAiAction =
  | ({ type: "shell" } & EvaluatedCommand)
  | ({ type: "saved_server"; serverName: string } & EvaluatedCommand);

export interface PendingApprovalState {
  tabId: string;
  input: AiChatInput;
  action: EvaluatedAiAction;
  displayCommand: string;
  cardId: string;
  previousCards: AiCommandCard[];
  executedCommands: ExecutedAiCommandContext[];
  createdAt: number;
  emit?: AgentEmitter;
}

export type AgentActionResult =
  | {
      status: "continue";
      commandCards: AiCommandCard[];
      executedCommands: ExecutedAiCommandContext[];
    }
  | { status: "return"; result: AiChatResult };

export interface ExecuteAgentActionInput {
  input: AiChatInput;
  signal: AbortSignal;
  emit?: AgentEmitter;
  action: EvaluatedAiAction;
  commandCards: AiCommandCard[];
  executedCommands: ExecutedAiCommandContext[];
  messages: AiMessage[];
  storeApproval: (approvalId: string, state: PendingApprovalState) => void;
  onCommandExecuted?: (command: ExecutedAiCommandContext) => void;
  approval?: {
    id: string;
    cardId: string;
    cardCreatedAt: number;
  };
}

function createId(): string {
  return crypto.randomUUID();
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function createAssistantMessage(content: string): AiMessage {
  return {
    id: createId(),
    role: "assistant",
    content: content || "未收到有效回复。",
    createdAt: Date.now(),
  };
}

function getWorkingDirectory(input: AiChatInput): string | undefined {
  return input.context.currentPath || input.context.sftpPath;
}

function getDisplayCommand(action: EvaluatedAiAction): string {
  return action.type === "saved_server"
    ? `[${action.serverName}] ${action.command}`
    : action.command;
}

function createCard(
  input: AiChatInput,
  action: EvaluatedAiAction,
  status: AiCommandCard["status"],
  options: {
    id?: string;
    createdAt?: number;
    approvalId?: string;
    reason?: string;
    result?: AiCommandResult;
    error?: string;
  } = {},
): AiCommandCard {
  return {
    id: options.id ?? createId(),
    tabId: input.tabId,
    conversationId: input.conversationId,
    command: getDisplayCommand(action),
    reason: options.reason ?? action.reason,
    workingDirectory:
      action.type === "saved_server" ? undefined : getWorkingDirectory(input),
    risk: action.risk,
    status,
    createdAt: options.createdAt ?? Date.now(),
    approvalId: options.approvalId,
    result: options.result,
    error: options.error,
  };
}

function mergeCards(
  previousCards: AiCommandCard[],
  nextCard: AiCommandCard,
): AiCommandCard[] {
  return previousCards.some(card => card.id === nextCard.id)
    ? previousCards.map(card => (card.id === nextCard.id ? nextCard : card))
    : [...previousCards, nextCard];
}

/** 把模型的一次工具调用归一化为 Agent 唯一动作。 */
export function getNextAgentAction(
  parsed: ParsedAssistantResponse,
): EvaluatedAiAction | null {
  const saved = parsed.savedServerCommands?.find(
    item => item.command.trim() && item.serverName.trim(),
  );
  if (saved) {
    const command = saved.command.trim();
    return {
      type: "saved_server",
      ...saved,
      command,
      serverName: saved.serverName.trim(),
      policy: evaluateAiCommand(command),
    };
  }

  const shell = parsed.commands?.find(item => item.command.trim());
  if (!shell) return null;
  const command = shell.command.trim();
  const policy = evaluateAiCommand(command);
  return {
    type: "shell",
    ...shell,
    command,
    reason: shell.reason || policy.reason,
    policy,
  };
}

/** 审批恢复前重新计算本地策略，避免旧审批绕过更新后的安全规则。 */
export function reevaluateAgentAction(
  action: EvaluatedAiAction,
): EvaluatedAiAction {
  return {
    ...action,
    policy: evaluateAiCommand(action.command),
  };
}

/** 生成本地策略反馈，供 Agent 请求模型修正被拒绝的动作。 */
export function createPolicyRejectionFeedback(
  action: EvaluatedAiAction,
  retryCount: number,
  maxRetries: number,
): LocalPolicyRejectionFeedback {
  return {
    type: "local_command_policy_rejection",
    toolCallId: action.toolCallId,
    toolName: "run_shell_command",
    retryCount,
    maxRetries,
    command: action.command,
    commandReason: action.reason,
    risk: action.risk,
    decision: "deny",
    reason: action.policy.reason,
  };
}

/** 展示本地策略拒绝的动作，拒绝结果不能通过审批绕过。 */
export function emitRejectedAction(
  input: AiChatInput,
  action: EvaluatedAiAction,
  commandCards: AiCommandCard[],
  emit?: AgentEmitter,
): AiCommandCard[] {
  const card = createCard(input, action, "rejected", {
    error: action.policy.reason,
  });
  emit?.sendCommandCard(card);
  return mergeCards(commandCards, card);
}

/** 把待审批卡片转为已取消，用于过期、新请求和标签页关闭。 */
export function cancelPendingApproval(
  approvalId: string,
  approval: PendingApprovalState,
  reason: string,
  emit?: AgentEmitter,
): void {
  const previousCard = approval.previousCards.find(
    card => card.id === approval.cardId,
  );
  const card = createCard(approval.input, approval.action, "cancelled", {
    id: approval.cardId,
    createdAt: previousCard?.createdAt ?? approval.createdAt,
    approvalId,
    error: reason,
  });
  (approval.emit ?? emit)?.sendCommandCard(card);
}

function pauseForApproval(
  request: ExecuteAgentActionInput,
  cardId: string,
  cardCreatedAt: number,
  reason: string,
): AgentActionResult {
  const approvalId = createId();
  const approvalCard = createCard(
    request.input,
    request.action,
    "requires_approval",
    {
      id: cardId,
      createdAt: cardCreatedAt,
      approvalId,
      reason,
    },
  );
  request.emit?.sendCommandCard(approvalCard);
  const nextCards = mergeCards(request.commandCards, approvalCard);
  request.storeApproval(approvalId, {
    tabId: request.input.tabId,
    input: request.input,
    action: request.action,
    displayCommand: approvalCard.command,
    cardId,
    previousCards: nextCards,
    executedCommands: request.executedCommands,
    createdAt: Date.now(),
    emit: request.emit,
  });
  return {
    status: "return",
    result: { messages: request.messages, commandCards: nextCards },
  };
}

async function executeShellAction(
  request: ExecuteAgentActionInput,
  cardId: string,
  cardCreatedAt: number,
): Promise<AgentActionResult> {
  const { input, action, emit, signal, messages } = request;
  let nextCards = request.commandCards;

  const runningCard = createCard(input, action, "running", {
    id: cardId,
    createdAt: cardCreatedAt,
    approvalId: request.approval?.id,
  });
  emit?.sendCommandCard(runningCard);
  nextCards = mergeCards(nextCards, runningCard);

  try {
    writeAppLog({
      scope: "main.ai",
      message: "AI 命令执行开始",
      data: {
        tabId: input.tabId,
        mode: input.mode,
        commandLength: action.command.length,
        risk: action.risk,
      },
    });
    const result = await executeTerminalCommand(input.tabId, action.command, {
      timeoutMs: 20_000,
      signal,
      workingDirectory: getWorkingDirectory(input),
    });
    const completedCard = createCard(input, action, "completed", {
      id: cardId,
      createdAt: cardCreatedAt,
      approvalId: request.approval?.id,
      result,
    });
    emit?.sendCommandCard(completedCard);
    nextCards = mergeCards(nextCards, completedCard);
    writeAppLog({
      scope: "main.ai",
      message: "AI 命令执行完成",
      data: {
        tabId: input.tabId,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      },
    });
    const executedCommand: ExecutedAiCommandContext = {
      toolCallId: action.toolCallId,
      toolName: "run_shell_command",
      command: action.command,
      reason: action.reason,
      risk: action.risk,
      workingDirectory: getWorkingDirectory(input),
      result,
    };
    request.onCommandExecuted?.(executedCommand);
    return {
      status: "continue",
      commandCards: nextCards,
      executedCommands: [
        ...request.executedCommands,
        executedCommand,
      ],
    };
  } catch (error) {
    const cancelled = isAbortError(error) || signal.aborted;
    const errorMessage = cancelled
      ? "操作已终止"
      : error instanceof Error
        ? error.message
        : String(error);
    request.onCommandExecuted?.({
      toolCallId: action.toolCallId,
      toolName: "run_shell_command",
      command: action.command,
      reason: action.reason,
      risk: action.risk,
      workingDirectory: getWorkingDirectory(input),
      result: {
        stdout: "",
        stderr: errorMessage,
        exitCode: null,
        timedOut: false,
        durationMs: 0,
      },
    });
    const card = createCard(input, action, cancelled ? "cancelled" : "failed", {
      id: cardId,
      createdAt: cardCreatedAt,
      approvalId: request.approval?.id,
      error: errorMessage,
    });
    emit?.sendCommandCard(card);
    nextCards = mergeCards(nextCards, card);
    messages.push(
      createAssistantMessage(
        cancelled
          ? "[已终止]"
          : `命令执行失败：${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return { status: "return", result: { messages, commandCards: nextCards } };
  }
}

async function executeSavedServerAction(
  request: ExecuteAgentActionInput,
  cardId: string,
  cardCreatedAt: number,
): Promise<AgentActionResult> {
  const { input, action, emit, signal, messages } = request;
  if (action.type !== "saved_server") {
    throw new Error("已保存服务器动作类型不匹配");
  }

  const runningCard = createCard(input, action, "running", {
    id: cardId,
    createdAt: cardCreatedAt,
    approvalId: request.approval?.id,
  });
  emit?.sendCommandCard(runningCard);
  let nextCards = mergeCards(request.commandCards, runningCard);

  try {
    const remote = await executeSavedServerCommand({
      serverReference: action.serverName,
      command: action.command,
      mode: input.mode,
      risk: action.risk,
      approvalGranted: Boolean(request.approval),
      signal,
    });
    const completedCard = createCard(input, action, "completed", {
      id: cardId,
      createdAt: cardCreatedAt,
      approvalId: request.approval?.id,
      result: remote.result,
    });
    emit?.sendCommandCard(completedCard);
    nextCards = mergeCards(nextCards, completedCard);
    const executedCommand: ExecutedAiCommandContext = {
      toolCallId: action.toolCallId,
      toolName: "run_saved_server_command",
      command: action.command,
      serverName: remote.serverName,
      reason: action.reason,
      risk: action.risk,
      result: remote.result,
    };
    request.onCommandExecuted?.(executedCommand);
    return {
      status: "continue",
      commandCards: nextCards,
      executedCommands: [
        ...request.executedCommands,
        executedCommand,
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    request.onCommandExecuted?.({
      toolCallId: action.toolCallId,
      toolName: "run_saved_server_command",
      command: action.command,
      serverName: action.serverName,
      reason: action.reason,
      risk: action.risk,
      result: {
        stdout: "",
        stderr: errorMessage,
        exitCode: null,
        timedOut: false,
        durationMs: 0,
      },
    });
    const card = createCard(input, action, "failed", {
      id: cardId,
      createdAt: cardCreatedAt,
      approvalId: request.approval?.id,
      error: errorMessage,
    });
    emit?.sendCommandCard(card);
    nextCards = mergeCards(nextCards, card);
    messages.push(
      createAssistantMessage(
        `已保存服务器查询失败：${errorMessage}`,
      ),
    );
    return { status: "return", result: { messages, commandCards: nextCards } };
  }
}

/** 统一执行当前终端和已保存服务器动作，并封装审批与命令卡状态。 */
export async function executeAgentAction(
  request: ExecuteAgentActionInput,
): Promise<AgentActionResult> {
  const cardId = request.approval?.cardId ?? createId();
  const cardCreatedAt = request.approval?.cardCreatedAt ?? Date.now();

  // 跨服务器连接始终先于审批判断拦截，禁止借当前终端绕过受控连接。
  if (
    request.action.type === "shell" &&
    /^\s*(?:ssh|scp|sftp)\b/i.test(request.action.command)
  ) {
    const card = createCard(request.input, request.action, "rejected", {
      error: "跨服务器操作必须使用已保存服务器工具，不能通过当前终端跳转 SSH",
    });
    request.emit?.sendCommandCard(card);
    request.messages.push(
      createAssistantMessage(
        "已拦截通过当前服务器跳转 SSH 的命令。请使用已保存服务器名称，我会通过本地受控连接执行。",
      ),
    );
    return {
      status: "return",
      result: {
        messages: request.messages,
        commandCards: mergeCards(request.commandCards, card),
      },
    };
  }

  const permission = resolveAiCommandPermission(
    request.input.mode,
    request.action.risk,
    request.action.policy,
    Boolean(request.approval),
  );

  if (permission.decision === "deny") {
    if (request.action.type === "saved_server") {
      const card = createCard(request.input, request.action, "rejected", {
        error: permission.reason,
      });
      request.emit?.sendCommandCard(card);
      return {
        status: "return",
        result: {
          messages: request.messages,
          commandCards: mergeCards(request.commandCards, card),
        },
      };
    }
    request.messages.push(createAssistantMessage(`命令已被本地策略拒绝：${permission.reason}`));
    return {
      status: "return",
      result: {
        messages: request.messages,
        commandCards: request.commandCards,
      },
    };
  }

  if (permission.decision === "requires_approval") {
    return pauseForApproval(
      request,
      cardId,
      cardCreatedAt,
      request.input.mode === "ask" ? request.action.reason : permission.reason,
    );
  }

  if (request.signal.aborted) {
    request.messages.push(createAssistantMessage("[已终止]"));
    return {
      status: "return",
      result: {
        messages: request.messages,
        commandCards: request.commandCards,
      },
    };
  }

  return request.action.type === "saved_server"
    ? executeSavedServerAction(request, cardId, cardCreatedAt)
    : executeShellAction(request, cardId, cardCreatedAt);
}
