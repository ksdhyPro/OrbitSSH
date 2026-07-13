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
  formatCommandResultForPrompt,
  truncateText,
  type ExecutedAiCommandContext,
} from "./ai-context.js";
import {
  requestAiTurn,
  type ParsedAiCommand,
  type ParsedAssistantResponse,
} from "./ai-provider.js";
import {
  evaluateAiCommand,
  splitAiShellCommands,
} from "./command-policy.js";
import { ExpiringApprovalStore } from "./ai-approval-store.js";

interface PendingApprovalState {
  tabId: string;
  input: AiChatInput;
  command: ParsedAiCommand;
  cardId: string;
  previousCards: AiCommandCard[];
  executedCommands: ExecutedAiCommandContext[];
  createdAt: number;
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

const maxAgentCommandCount = 10;
const approvalTtlMs = 5 * 60 * 1000;
const pendingApprovals = new ExpiringApprovalStore<PendingApprovalState>();
const activeRequests = new Map<string, AbortController>();

function createId(): string {
  return crypto.randomUUID();
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function normalizeCommandForCompare(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function findExecutedCommand(
  executedCommands: ExecutedAiCommandContext[],
  command: string,
): ExecutedAiCommandContext | undefined {
  const normalized = normalizeCommandForCompare(command);
  return executedCommands.find(
    item => normalizeCommandForCompare(item.command) === normalized,
  );
}

function formatRepeatedCommandMessage(
  command: string,
  result: AiCommandResult,
): string {
  return [
    `命令 ${command} 刚刚已经执行过，本轮不再重复执行。`,
    `退出码：${result.exitCode ?? "未知"}。`,
    `结果摘要：\n${truncateText(formatCommandResultForPrompt(result), 2_000)}`,
    "请基于以上结果继续判断。",
  ].join("\n");
}

function getNextParsedCommand(
  parsed: ParsedAssistantResponse,
): EvaluatedAiCommand | null {
  const command = parsed.commands?.find(item => item.command.trim());
  if (!command) return null;
  const text = command.command.trim();
  const policy = evaluateAiCommand(text);
  return {
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
    command: command.command,
    reason,
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
    command: command.command,
    reason: command.reason,
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
  tabId: string,
  webContents?: WebContents,
): AgentEmitter | undefined {
  if (!webContents) return undefined;
  return {
    sendMessageStart: (messageId, createdAt) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-message-start", {
        tabId,
        messageId,
        createdAt,
      } satisfies AiStreamMessageStartEvent);
    },
    sendChunk: (messageId, text) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-chunk", {
        tabId,
        messageId,
        chunk: text,
      } satisfies AiStreamChunkEvent);
    },
    sendCommandCard: card => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:command-card", {
        tabId,
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
  approval.emit?.sendCommandCard(
    createCancelledCard(
      approval.input,
      approval.command,
      approval.cardId,
      previousCard?.createdAt ?? approval.createdAt,
      approvalId,
      "命令授权已过期",
    ),
  );
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
    (emit ?? approval.emit)?.sendCommandCard(
      createCancelledCard(
        approval.input,
        approval.command,
        approval.cardId,
        previousCard?.createdAt ?? approval.createdAt,
        approvalId,
        reason,
      ),
    );
  }
}

function buildCommandQueue(
  input: AiChatInput,
  command: ParsedAiCommand,
): ParsedAiCommand[] {
  if (input.mode !== "full") return [command];
  const segments = splitAiShellCommands(command.command);
  if (segments.length === 0) return [command];
  return segments.map(segment => ({
    command: segment.command,
    reason: command.reason,
    risk: command.risk,
  }));
}

function getApprovalReason(
  input: AiChatInput,
  command: EvaluatedAiCommand,
): string | null {
  if (input.mode === "ask") return command.reason;
  if (command.risk === "high" || command.policy.decision === "requires_approval") {
    return command.policy.reason;
  }

  for (const segment of buildCommandQueue(input, command)) {
    const policy = evaluateAiCommand(segment.command);
    if (policy.decision === "deny") return policy.reason;
    if (policy.decision === "requires_approval") {
      return `需确认子命令：${segment.command}\n${policy.reason}`;
    }
  }
  return null;
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

  if (command.policy.decision === "deny") {
    messages.push(createAssistantMessage(`命令已被本地策略拒绝：${command.policy.reason}`));
    return { status: "return", result: { messages, commandCards: nextCards } };
  }

  const approvalReason = options.bypassApproval
    ? null
    : getApprovalReason(input, command);
  if (approvalReason) {
    const approvalId = createId();
    const approvalCard = createApprovalCard(
      input,
      command,
      approvalId,
      cardId,
      cardCreatedAt,
      approvalReason,
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
        command: command.command,
        risk: command.risk,
      },
    });
    const result = await executeTerminalCommand(input.tabId, command.command, {
      timeoutMs: 20_000,
      signal,
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
        command: command.command,
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
          command: command.command,
          reason: command.reason,
          risk: command.risk,
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

async function runAgentLoop(
  input: AiChatInput,
  settings: AppSettings,
  signal: AbortSignal,
  emit?: AgentEmitter,
  previousCards: AiCommandCard[] = [],
  initialExecutedCommands: ExecutedAiCommandContext[] = [],
): Promise<AiChatResult> {
  const messages: AiMessage[] = [];
  let commandCards = [...previousCards];
  let executedCommands = [...initialExecutedCommands];

  while (executedCommands.length < maxAgentCommandCount) {
    if (signal.aborted) {
      messages.push(createAssistantMessage("[已终止]"));
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
    );
    const reply = parsed.reply?.trim();
    const nextCommand = getNextParsedCommand(parsed);
    const repeatedCommand = nextCommand
      ? findExecutedCommand(executedCommands, nextCommand.command)
      : undefined;

    if (nextCommand && repeatedCommand) {
      const repeatedMessage = formatRepeatedCommandMessage(
        nextCommand.command,
        repeatedCommand.result,
      );
      messages.push({
        id: messageId,
        role: "assistant",
        content: reply ? `${reply}\n\n${repeatedMessage}` : repeatedMessage,
        createdAt: messageCreatedAt,
      });
      return { messages, commandCards };
    }

    messages.push({
      id: messageId,
      role: "assistant",
      content: reply
        ? reply
        : nextCommand
          ? `执行：${nextCommand.command}（${nextCommand.reason}）`
          : "未收到有效回复。",
      createdAt: messageCreatedAt,
    });
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

  messages.push(
    createAssistantMessage(
      `已达到单轮最多 ${maxAgentCommandCount} 条命令的限制，请根据当前结果继续提问。`,
    ),
  );
  return { messages, commandCards };
}

async function runTrackedRequest<T>(
  tabId: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  activeRequests.get(tabId)?.abort();
  const controller = new AbortController();
  activeRequests.set(tabId, controller);
  try {
    return await operation(controller.signal);
  } finally {
    if (activeRequests.get(tabId) === controller) activeRequests.delete(tabId);
  }
}

export async function runAiChat(
  input: AiChatInput,
  settings: AppSettings,
  webContents?: WebContents,
): Promise<AiChatResult> {
  const emit = makeEmitter(input.tabId, webContents);
  clearPendingApprovalsForTab(input.tabId, "已开始新的 AI 请求", emit);
  return runTrackedRequest(input.tabId, signal =>
    runAgentLoop(input, settings, signal, emit),
  );
}

export function cancelAiRequest(input: AiCancelInput): boolean {
  const controller = activeRequests.get(input.tabId);
  if (!controller) return false;
  controller.abort();
  writeAppLog({
    scope: "main.ai",
    message: "AI 请求已被用户终止",
    data: { tabId: input.tabId },
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
    approval.command.command !== input.command.trim()
  ) {
    throw new Error("命令授权与当前命令不匹配");
  }
  if (!pendingApprovals.take(input.approvalId)) {
    throw new Error("命令授权不存在或已过期");
  }
  const emit = makeEmitter(input.tabId, webContents);

  return runTrackedRequest(input.tabId, async signal => {
    let commandCards = approval.previousCards;
    let executedCommands = [...approval.executedCommands];
    const messages: AiMessage[] = [];
    const previousCard = commandCards.find(card => card.id === approval.cardId);
    const cardCreatedAt = previousCard?.createdAt ?? Date.now();
    const evaluatedCommand: EvaluatedAiCommand = {
      ...approval.command,
      policy: evaluateAiCommand(approval.command.command),
    };
    const execution = await executeAgentCommand(
      approval.input,
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
      approval.input,
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
  if (!approval || approval.input.tabId !== input.tabId) return false;
  if (!pendingApprovals.take(input.approvalId)) return false;
  writeAppLog({
    scope: "main.ai",
    message: "AI 命令授权已拒绝",
    data: { tabId: input.tabId, command: approval.command.command },
  });
  return true;
}

export function disposeAiTabState(tabId: string): void {
  activeRequests.get(tabId)?.abort();
  activeRequests.delete(tabId);
  clearPendingApprovalsForTab(tabId, "终端标签页已关闭");
}
