import type {
  AiApprovedCommandInput,
  AiCancelInput,
  AiChatInput,
  AiChatResult,
  AiCommandCard,
  AiCommandCardEvent,
  AiCommandPolicyResult,
  AiCommandResult,
  AiMessage,
  AiRejectedCommandInput,
  AiStreamChunkEvent,
  AiStreamMessageStartEvent,
} from "../../shared/ai.js";
import type { AppSettings } from "../../shared/settings.js";
import type { WebContents } from "electron";
import { writeAppLog } from "../logger.js";
import { executeTerminalCommand } from "../ssh/session-manager.js";
import {
  type ExecutedAiCommandContext,
  type LocalPolicyRejectionFeedback,
} from "./ai-context.js";
import {
  requestAiTurn,
  type ParsedAiCommand,
  type ParsedAiSavedServerCommand,
  type ParsedAssistantResponse,
} from "./ai-provider.js";
import { executeSavedServerCommand } from './ai-saved-server-command.js';
import { resolveAiCommandPermission } from "./ai-permission-policy.js";
import { evaluateAiCommand } from "./command-policy.js";
import { ExpiringApprovalStore } from "./ai-approval-store.js";
import { getAiExecutionStopReason } from './ai-execution-budget.js';

interface PendingApprovalState {
  tabId: string;
  input: AiChatInput;
  command: ParsedAiCommand;
  cardId: string;
  previousCards: AiCommandCard[];
  executedCommands: ExecutedAiCommandContext[];
  createdAt: number;
  /** 已保存服务器动作，批准后仍会由执行适配器再次校验权限。 */
  savedServerCommand?: ParsedAiSavedServerCommand;
  emit?: AgentEmitter;
}

interface EvaluatedAiCommand extends ParsedAiCommand {
  policy: AiCommandPolicyResult;
}

interface AgentEmitter {
  sendMessageStart(messageId: string, createdAt: number): void;
  sendChunk(messageId: string, text: string): void;
  sendCommandCard(card: AiCommandCard): void;
}

interface ActiveAiRequest {
  requestId: string;
  conversationId: string;
  controller: AbortController;
}

const maxLocalPolicyRetries = 3;
const approvalTtlMs = 5 * 60 * 1000;
const pendingApprovals = new ExpiringApprovalStore<PendingApprovalState>();
const activeRequests = new Map<string, ActiveAiRequest>();

function createId(): string {
  return crypto.randomUUID();
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function getNextParsedCommand(
  parsed: ParsedAssistantResponse,
): EvaluatedAiCommand | null {
  const command = parsed.commands?.find(item => item.command.trim());
  if (!command) return null;
  const text = command.command.trim();
  const policy = evaluateAiCommand(text);
  return {
    toolCallId: command.toolCallId,
    command: text,
    reason: command.reason || policy.reason,
    risk: command.risk,
    policy,
  };
}

function createAssistantMessage(content: string): AiMessage {
  return {
    id: createId(),
    role: "assistant",
    content: content || "未收到有效回复。",
    createdAt: Date.now(),
  };
}

function createApprovalCard(
  input: AiChatInput,
  command: ParsedAiCommand,
  approvalId: string,
  cardId = createId(),
  createdAt = Date.now(),
  reason = command.reason,
): AiCommandCard {
  return {
    id: cardId,
    tabId: input.tabId,
    conversationId: input.conversationId,
    command: command.command,
    reason,
    workingDirectory: getInputWorkingDirectory(input),
    risk: command.risk,
    status: "requires_approval",
    createdAt,
    approvalId,
  };
}

function createRunningCard(
  input: AiChatInput,
  command: ParsedAiCommand,
  cardId = createId(),
  createdAt = Date.now(),
  approvalId?: string,
): AiCommandCard {
  return {
    id: cardId,
    tabId: input.tabId,
    conversationId: input.conversationId,
    command: command.command,
    reason: command.reason,
    workingDirectory: getInputWorkingDirectory(input),
    risk: command.risk,
    status: "running",
    createdAt,
    approvalId,
  };
}

function createCompletedCard(
  input: AiChatInput,
  command: ParsedAiCommand,
  result: AiCommandResult,
  cardId: string,
  createdAt: number,
  approvalId?: string,
): AiCommandCard {
  return {
    ...createRunningCard(input, command, cardId, createdAt, approvalId),
    status: "completed",
    result,
  };
}

function createFailedCard(
  input: AiChatInput,
  command: ParsedAiCommand,
  error: unknown,
  cardId: string,
  createdAt: number,
  approvalId?: string,
): AiCommandCard {
  return {
    ...createRunningCard(input, command, cardId, createdAt, approvalId),
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  };
}

/** 记录本地策略拒绝，便于用户查看模型生成的原始命令与拒绝原因。 */
function createRejectedCard(
  input: AiChatInput,
  command: EvaluatedAiCommand,
  policyReason: string,
): AiCommandCard {
  return {
    id: createId(),
    tabId: input.tabId,
    conversationId: input.conversationId,
    command: command.command,
    reason: command.reason,
    workingDirectory: getInputWorkingDirectory(input),
    risk: command.risk,
    status: "rejected",
    createdAt: Date.now(),
    error: policyReason,
  };
}

function createCancelledCard(
  input: AiChatInput,
  command: ParsedAiCommand,
  cardId: string,
  createdAt: number,
  approvalId?: string,
  reason = "操作已终止",
): AiCommandCard {
  return {
    ...createRunningCard(input, command, cardId, createdAt, approvalId),
    status: "cancelled",
    error: reason,
  };
}

function mergeCards(
  previousCards: AiCommandCard[],
  nextCard: AiCommandCard,
): AiCommandCard[] {
  const exists = previousCards.some(card => card.id === nextCard.id);
  return exists
    ? previousCards.map(card => (card.id === nextCard.id ? nextCard : card))
    : [...previousCards, nextCard];
}

function makeEmitter(
  input: Pick<AiChatInput, "tabId" | "requestId" | "conversationId">,
  webContents?: WebContents,
): AgentEmitter | undefined {
  if (!webContents) return undefined;
  return {
    sendMessageStart: (messageId, createdAt) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-message-start", {
        tabId: input.tabId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        messageId,
        createdAt,
      } satisfies AiStreamMessageStartEvent);
    },
    sendChunk: (messageId, text) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-chunk", {
        tabId: input.tabId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        messageId,
        chunk: text,
      } satisfies AiStreamChunkEvent);
    },
    sendCommandCard: card => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:command-card", {
        tabId: input.tabId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        card,
      } satisfies AiCommandCardEvent);
    },
  };
}

function notifyExpiredApproval(
  approvalId: string,
  approval: PendingApprovalState,
): void {
  const previousCard = approval.previousCards.find(card => card.id === approval.cardId);
  approval.emit?.sendCommandCard({
    ...createCancelledCard(
      approval.input,
      approval.command,
      approval.cardId,
      previousCard?.createdAt ?? approval.createdAt,
      approvalId,
      "命令授权已过期",
    ),
    workingDirectory: previousCard?.workingDirectory,
  });
}

function storePendingApproval(
  approvalId: string,
  state: PendingApprovalState,
): void {
  pendingApprovals.set(
    approvalId,
    state,
    approvalTtlMs,
    notifyExpiredApproval,
  );
}

function clearPendingApprovalsForTab(
  tabId: string,
  reason: string,
  emit?: AgentEmitter,
): void {
  for (const { id: approvalId, value: approval } of pendingApprovals.clearForTab(tabId)) {
    const previousCard = approval.previousCards.find(card => card.id === approval.cardId);
    (approval.emit ?? emit)?.sendCommandCard({
      ...createCancelledCard(
        approval.input,
        approval.command,
        approval.cardId,
        previousCard?.createdAt ?? approval.createdAt,
        approvalId,
        reason,
      ),
      workingDirectory: previousCard?.workingDirectory,
    });
  }
}

function createPolicyRejectionFeedback(
  command: EvaluatedAiCommand,
  retryCount: number,
): LocalPolicyRejectionFeedback {
  return {
    type: "local_command_policy_rejection",
    toolCallId: command.toolCallId,
    toolName: "run_shell_command",
    retryCount,
    maxRetries: maxLocalPolicyRetries,
    command: command.command,
    commandReason: command.reason,
    risk: command.risk,
    decision: "deny",
    reason: command.policy.reason,
  };
}

type CommandExecutionResult =
  | {
      status: "continue";
      commandCards: AiCommandCard[];
      executedCommands: ExecutedAiCommandContext[];
    }
  | { status: "return"; result: AiChatResult };

async function executeAgentCommand(
  input: AiChatInput,
  signal: AbortSignal,
  emit: AgentEmitter | undefined,
  command: EvaluatedAiCommand,
  commandCards: AiCommandCard[],
  executedCommands: ExecutedAiCommandContext[],
  messages: AiMessage[],
  options: {
    approvalId?: string;
    bypassApproval?: boolean;
    cardId?: string;
    cardCreatedAt?: number;
  } = {},
): Promise<CommandExecutionResult> {
  const cardId = options.cardId ?? createId();
  const cardCreatedAt = options.cardCreatedAt ?? Date.now();
  let nextCards = commandCards;

  // 已保存连接必须由主进程受控工具直连，禁止模型借当前服务器二次 ssh/scp 跳转。
  if (/^\s*(?:ssh|scp|sftp)\b/i.test(command.command)) {
    const rejectedCard = createRejectedCard(
      input,
      command,
      "跨服务器操作必须使用已保存服务器工具，不能通过当前终端跳转 SSH",
    );
    emit?.sendCommandCard(rejectedCard);
    nextCards = mergeCards(nextCards, rejectedCard);
    messages.push(createAssistantMessage("已拦截通过当前服务器跳转 SSH 的命令。请使用已保存服务器名称，我会通过本地受控连接执行。"));
    return { status: "return", result: { messages, commandCards: nextCards } };
  }

  const permission = resolveAiCommandPermission(
    input.mode,
    command.risk,
    command.policy,
    options.bypassApproval ?? false,
  );
  if (permission.decision === "deny") {
    messages.push(createAssistantMessage(`命令已被本地策略拒绝：${permission.reason}`));
    return { status: "return", result: { messages, commandCards: nextCards } };
  }

  if (permission.decision === "requires_approval") {
    const approvalId = createId();
    const approvalCard = createApprovalCard(
      input,
      command,
      approvalId,
      cardId,
      cardCreatedAt,
      input.mode === "ask" ? command.reason : permission.reason,
    );
    emit?.sendCommandCard(approvalCard);
    nextCards = mergeCards(nextCards, approvalCard);
    storePendingApproval(approvalId, {
      tabId: input.tabId,
      input,
      command,
      cardId,
      previousCards: nextCards,
      executedCommands,
      createdAt: Date.now(),
      emit,
    });
    return { status: "return", result: { messages, commandCards: nextCards } };
  }

  if (signal.aborted) {
    messages.push(createAssistantMessage("[已终止]"));
    return { status: "return", result: { messages, commandCards: nextCards } };
  }
  const runningCard = createRunningCard(
    input,
    command,
    cardId,
    cardCreatedAt,
    options.approvalId,
  );
  emit?.sendCommandCard(runningCard);
  nextCards = mergeCards(nextCards, runningCard);

  try {
    writeAppLog({
      scope: "main.ai",
      message: "AI 命令执行开始",
      data: {
        tabId: input.tabId,
        mode: input.mode,
        commandLength: command.command.length,
        risk: command.risk,
      },
    });
    const result = await executeTerminalCommand(input.tabId, command.command, {
      timeoutMs: 20_000,
      signal,
      workingDirectory: getInputWorkingDirectory(input),
    });
    const completedCard = createCompletedCard(
      input,
      command,
      result,
      cardId,
      cardCreatedAt,
      options.approvalId,
    );
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
    return {
      status: "continue",
      commandCards: nextCards,
      executedCommands: [
        ...executedCommands,
        {
          toolCallId: command.toolCallId,
          toolName: "run_shell_command",
          command: command.command,
          reason: command.reason,
          risk: command.risk,
          workingDirectory: getInputWorkingDirectory(input),
          result,
        },
      ],
    };
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      const cancelledCard = createCancelledCard(
        input,
        command,
        cardId,
        cardCreatedAt,
        options.approvalId,
      );
      emit?.sendCommandCard(cancelledCard);
      nextCards = mergeCards(nextCards, cancelledCard);
      messages.push(createAssistantMessage("[已终止]"));
      return { status: "return", result: { messages, commandCards: nextCards } };
    }
    const failedCard = createFailedCard(
      input,
      command,
      error,
      cardId,
      cardCreatedAt,
      options.approvalId,
    );
    emit?.sendCommandCard(failedCard);
    nextCards = mergeCards(nextCards, failedCard);
    messages.push(
      createAssistantMessage(
        `命令执行失败：${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return { status: "return", result: { messages, commandCards: nextCards } };
  }
}

async function executeSavedServerAgentCommand(
  input: AiChatInput,
  signal: AbortSignal,
  emit: AgentEmitter | undefined,
  command: EvaluatedAiCommand & { serverName: string },
  commandCards: AiCommandCard[],
  executedCommands: ExecutedAiCommandContext[],
  messages: AiMessage[],
  options: {
    approvalId?: string;
    bypassApproval?: boolean;
    cardId?: string;
    cardCreatedAt?: number;
  } = {},
): Promise<CommandExecutionResult> {
  const displayCommand = `[${command.serverName}] ${command.command}`;
  const displayItem: EvaluatedAiCommand = { ...command, command: displayCommand };

  const permission = resolveAiCommandPermission(
    input.mode,
    command.risk,
    command.policy,
    options.bypassApproval ?? false,
  );
  if (permission.decision === "deny") {
    const rejected = {
      ...createRejectedCard(input, displayItem, permission.reason),
      workingDirectory: undefined,
    };
    emit?.sendCommandCard(rejected);
    return { status: "return", result: { messages, commandCards: mergeCards(commandCards, rejected) } };
  }

  const cardId = options.cardId ?? createId();
  const createdAt = options.cardCreatedAt ?? Date.now();
  if (permission.decision === "requires_approval") {
    const approvalId = createId();
    const approvalCard = {
      ...createApprovalCard(
        input,
        displayItem,
        approvalId,
        cardId,
        createdAt,
        input.mode === "ask" ? command.reason : permission.reason,
      ),
      workingDirectory: undefined,
    };
    emit?.sendCommandCard(approvalCard);
    const nextCards = mergeCards(commandCards, approvalCard);
    storePendingApproval(approvalId, {
      tabId: input.tabId,
      input,
      command: displayItem,
      savedServerCommand: command,
      cardId,
      previousCards: nextCards,
      executedCommands,
      createdAt,
      emit,
    });
    return { status: "return", result: { messages, commandCards: nextCards } };
  }
  const running = {
    ...createRunningCard(
      input,
      displayItem,
      cardId,
      createdAt,
      options.approvalId,
    ),
    workingDirectory: undefined,
  };
  emit?.sendCommandCard(running);
  let nextCards = mergeCards(commandCards, running);

  try {
    const remote = await executeSavedServerCommand({
      serverReference: command.serverName,
      command: command.command,
      mode: input.mode,
      risk: command.risk,
      approvalGranted: options.bypassApproval,
      signal,
    });
    const completed = {
      ...createCompletedCard(
        input,
        displayItem,
        remote.result,
        cardId,
        createdAt,
        options.approvalId,
      ),
      workingDirectory: undefined,
    };
    emit?.sendCommandCard(completed);
    nextCards = mergeCards(nextCards, completed);
    return {
      status: "continue",
      commandCards: nextCards,
      executedCommands: [
        ...executedCommands,
        {
          toolCallId: command.toolCallId,
          toolName: "run_saved_server_command",
          command: command.command,
          serverName: remote.serverName,
          reason: command.reason,
          risk: command.risk,
          result: remote.result,
        },
      ],
    };
  } catch (error) {
    const failed = {
      ...createFailedCard(
        input,
        displayItem,
        error,
        cardId,
        createdAt,
        options.approvalId,
      ),
      workingDirectory: undefined,
    };
    emit?.sendCommandCard(failed);
    nextCards = mergeCards(nextCards, failed);
    messages.push(createAssistantMessage(`已保存服务器查询失败：${error instanceof Error ? error.message : String(error)}`));
    return { status: "return", result: { messages, commandCards: nextCards } };
  }
}

async function runAgentLoop(
  input: AiChatInput,
  settings: AppSettings,
  signal: AbortSignal,
  emit?: AgentEmitter,
  previousCards: AiCommandCard[] = [],
  initialExecutedCommands: ExecutedAiCommandContext[] = [],
): Promise<AiChatResult> {
  const messages: AiMessage[] = [];
  const startedAt = Date.now();
  let commandCards = [...previousCards];
  let executedCommands = [...initialExecutedCommands];
  let policyFeedback: LocalPolicyRejectionFeedback | undefined;
  let localPolicyRetryCount = 0;

  while (true) {
    if (signal.aborted) {
      messages.push(createAssistantMessage("[已终止]"));
      return { messages, commandCards };
    }
    const stopReason = getAiExecutionStopReason(executedCommands, startedAt);
    if (stopReason) {
      messages.push(createAssistantMessage(
        `${stopReason}\n\n已完成 ${executedCommands.length} 条命令检查。请根据当前结果继续提问，或提供新的排查方向。`,
      ));
      return { messages, commandCards };
    }
    const messageId = createId();
    const messageCreatedAt = Date.now() + 1;
    emit?.sendMessageStart(messageId, messageCreatedAt);
    const parsed = await requestAiTurn(
      input,
      settings,
      executedCommands,
      signal,
      emit ? text => emit.sendChunk(messageId, text) : undefined,
      policyFeedback,
    );
    const reply = parsed.reply?.trim();
    const nextSavedServerCommand = getNextSavedServerCommand(parsed);
    const nextCommand = getNextParsedCommand(parsed);

    const defaultMessage = nextSavedServerCommand
      ? `查看已保存服务器：${nextSavedServerCommand.serverName}（${nextSavedServerCommand.reason}）`
      : nextCommand
      ? `执行：${nextCommand.command}（${nextCommand.reason}）`
      : "未收到有效回复。";

    if (nextCommand?.policy.decision === "deny") {
      const rejectedCard = createRejectedCard(
        input,
        nextCommand,
        nextCommand.policy.reason,
      );
      emit?.sendCommandCard(rejectedCard);
      commandCards = mergeCards(commandCards, rejectedCard);

      if (localPolicyRetryCount < maxLocalPolicyRetries) {
        localPolicyRetryCount += 1;
        policyFeedback = createPolicyRejectionFeedback(
          nextCommand,
          localPolicyRetryCount,
        );
        messages.push({
          id: messageId,
          role: "assistant",
          content: `${reply || defaultMessage}\n\n本地策略已拦截：${nextCommand.policy.reason}。正在请求模型第 ${localPolicyRetryCount}/${maxLocalPolicyRetries} 次修正。`,
          createdAt: messageCreatedAt,
        });
        continue;
      }

      messages.push({
        id: messageId,
        role: "assistant",
        content: `${reply || defaultMessage}\n\n本地策略重试已耗尽，该命令不可通过审批绕过。请修改需求或明确提供其他安全排查方向。`,
        createdAt: messageCreatedAt,
      });
      return { messages, commandCards };
    }

    policyFeedback = undefined;
    localPolicyRetryCount = 0;
    messages.push({
      id: messageId,
      role: "assistant",
      content: reply || defaultMessage,
      createdAt: messageCreatedAt,
    });
    if (nextSavedServerCommand) {
      const execution = await executeSavedServerAgentCommand(
        input,
        signal,
        emit,
        nextSavedServerCommand,
        commandCards,
        executedCommands,
        messages,
      );
      if (execution.status === "return") return execution.result;
      commandCards = execution.commandCards;
      executedCommands = execution.executedCommands;
      continue;
    }
    if (!nextCommand) return { messages, commandCards };

    const execution = await executeAgentCommand(
      input,
      signal,
      emit,
      nextCommand,
      commandCards,
      executedCommands,
      messages,
    );
    if (execution.status === "return") return execution.result;
    commandCards = execution.commandCards;
    executedCommands = execution.executedCommands;
  }

}

function getNextSavedServerCommand(
  parsed: ParsedAssistantResponse,
): (EvaluatedAiCommand & { serverName: string }) | null {
  const command = parsed.savedServerCommands?.find(item => item.command.trim() && item.serverName.trim());
  if (!command) return null;
  return {
    ...command,
    command: command.command.trim(),
    serverName: command.serverName.trim(),
    policy: evaluateAiCommand(command.command),
  };
}

function getInputWorkingDirectory(input: AiChatInput): string | undefined {
  return input.context.currentPath || input.context.sftpPath;
}

async function runTrackedRequest<T>(
  input: Pick<AiChatInput, "tabId" | "requestId" | "conversationId">,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  activeRequests.get(input.tabId)?.controller.abort();
  const controller = new AbortController();
  const activeRequest: ActiveAiRequest = {
    requestId: input.requestId,
    conversationId: input.conversationId,
    controller,
  };
  activeRequests.set(input.tabId, activeRequest);
  try {
    return await operation(controller.signal);
  } finally {
    if (activeRequests.get(input.tabId) === activeRequest) {
      activeRequests.delete(input.tabId);
    }
  }
}

export async function runAiChat(
  input: AiChatInput,
  settings: AppSettings,
  webContents?: WebContents,
): Promise<AiChatResult> {
  const emit = makeEmitter(input, webContents);
  clearPendingApprovalsForTab(input.tabId, "已开始新的 AI 请求", emit);
  return runTrackedRequest(input, signal =>
    runAgentLoop(input, settings, signal, emit),
  );
}

export function cancelAiRequest(input: AiCancelInput): boolean {
  const activeRequest = activeRequests.get(input.tabId);
  if (!activeRequest || activeRequest.requestId !== input.requestId) return false;
  activeRequest.controller.abort();
  writeAppLog({
    scope: "main.ai",
    message: "AI 请求已被用户终止",
    data: { tabId: input.tabId, requestId: input.requestId },
  });
  return true;
}

export async function runApprovedAiCommand(
  input: AiApprovedCommandInput,
  settings: AppSettings,
  webContents?: WebContents,
): Promise<AiChatResult> {
  const approval = pendingApprovals.get(input.approvalId);
  if (!approval) throw new Error("命令授权不存在或已过期");
  if (
    approval.input.tabId !== input.tabId ||
    approval.input.conversationId !== input.conversationId ||
    approval.command.command !== input.command.trim()
  ) {
    throw new Error("命令授权与当前命令不匹配");
  }
  if (!pendingApprovals.take(input.approvalId)) {
    throw new Error("命令授权不存在或已过期");
  }
  const resumedInput: AiChatInput = {
    ...approval.input,
    requestId: input.requestId,
    conversationId: input.conversationId,
  };
  const emit = makeEmitter(resumedInput, webContents);

  return runTrackedRequest(resumedInput, async signal => {
    let commandCards = approval.previousCards;
    let executedCommands = [...approval.executedCommands];
    const messages: AiMessage[] = [];
    const previousCard = commandCards.find(card => card.id === approval.cardId);
    const cardCreatedAt = previousCard?.createdAt ?? Date.now();
    if (approval.savedServerCommand) {
      const savedServerCommand: EvaluatedAiCommand & { serverName: string } = {
        ...approval.savedServerCommand,
        policy: evaluateAiCommand(approval.savedServerCommand.command),
      };
      const execution = await executeSavedServerAgentCommand(
        resumedInput,
        signal,
        emit,
        savedServerCommand,
        commandCards,
        executedCommands,
        messages,
        {
          approvalId: input.approvalId,
          bypassApproval: true,
          cardId: approval.cardId,
          cardCreatedAt,
        },
      );
      if (execution.status === "return") return execution.result;
      const loopResult = await runAgentLoop(
        resumedInput,
        settings,
        signal,
        emit,
        execution.commandCards,
        execution.executedCommands,
      );
      return {
        messages: [...messages, ...loopResult.messages],
        commandCards: loopResult.commandCards,
      };
    }
    const evaluatedCommand: EvaluatedAiCommand = {
      ...approval.command,
      policy: evaluateAiCommand(approval.command.command),
    };
    const execution = await executeAgentCommand(
      resumedInput,
      signal,
      emit,
      evaluatedCommand,
      commandCards,
      executedCommands,
      messages,
      {
        approvalId: input.approvalId,
        bypassApproval: true,
        cardId: approval.cardId,
        cardCreatedAt,
      },
    );
    if (execution.status === "return") return execution.result;
    commandCards = execution.commandCards;
    executedCommands = execution.executedCommands;
    const loopResult = await runAgentLoop(
      resumedInput,
      settings,
      signal,
      emit,
      commandCards,
      executedCommands,
    );
    return {
      messages: [...messages, ...loopResult.messages],
      commandCards: loopResult.commandCards,
    };
  });
}

export function rejectAiCommandApproval(
  input: AiRejectedCommandInput,
): boolean {
  const approval = pendingApprovals.get(input.approvalId);
  if (
    !approval ||
    approval.input.tabId !== input.tabId ||
    approval.input.conversationId !== input.conversationId
  ) return false;
  if (!pendingApprovals.take(input.approvalId)) return false;
  writeAppLog({
    scope: "main.ai",
    message: "AI 命令授权已拒绝",
    data: { tabId: input.tabId, commandLength: approval.command.command.length },
  });
  return true;
}

export function disposeAiTabState(tabId: string): void {
  activeRequests.get(tabId)?.controller.abort();
  activeRequests.delete(tabId);
  clearPendingApprovalsForTab(tabId, "终端标签页已关闭");
}
