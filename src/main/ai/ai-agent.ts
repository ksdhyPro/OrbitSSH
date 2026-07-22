import type {
  AiApprovedCommandInput,
  AiAttachmentReadResult,
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
  type LocalPolicyRejectionFeedback,
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
import { findExecutedAiCommand } from "./ai-command-dedup.js";
import { prepareAiChatInput } from "./ai-compaction.js";
import { readAiAttachmentChunk } from "./ai-attachment-reader.js";
import { describeAiCommandForApproval } from "./command-description.js";
import { shouldFinalizeAfterAiCommand } from "./ai-execution-guard.js";

interface PendingApprovalState {
  tabId: string;
  conversationId: string;
  input: AiChatInput;
  command: ParsedAiCommand;
  cardId: string;
  previousCards: AiCommandCard[];
  executedCommands: ExecutedAiCommandContext[];
  attachmentReads: AiAttachmentReadResult[];
  createdAt: number;
  /** AI 已耗尽本地策略重试后，用户可显式决定是否绕过该次拒绝。 */
  allowPolicyBypass?: boolean;
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

const maxLocalPolicyRetries = 3;
const maxAttachmentReadCount = 64;
const pendingApprovals = new ExpiringApprovalStore<PendingApprovalState>();
const activeRequests = new Map<
  string,
  { tabId: string; controller: AbortController }
>();

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

function createTimedOutCard(
  input: AiChatInput,
  command: ParsedAiCommand,
  result: AiCommandResult,
  cardId: string,
  createdAt: number,
  approvalId?: string,
): AiCommandCard {
  return {
    ...createRunningCard(input, command, cardId, createdAt, approvalId),
    status: "failed",
    result,
    error: "命令执行超时，已停止本轮 AI 自动执行",
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
    command: command.command,
    reason: command.reason,
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
  tabId: string,
  conversationId: string,
  webContents?: WebContents,
): AgentEmitter | undefined {
  if (!webContents) return undefined;
  return {
    sendMessageStart: (messageId, createdAt) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-message-start", {
        tabId,
        conversationId,
        messageId,
        createdAt,
      } satisfies AiStreamMessageStartEvent);
    },
    sendChunk: (messageId, text) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-chunk", {
        tabId,
        conversationId,
        messageId,
        chunk: text,
      } satisfies AiStreamChunkEvent);
    },
    sendCommandCard: card => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:command-card", {
        tabId,
        conversationId,
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
  ttlMs: number,
): void {
  pendingApprovals.set(
    approvalId,
    state,
    ttlMs,
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
  if (input.mode === "ask") {
    return describeAiCommandForApproval(command.command, {
      modelReason: command.reason,
      policy: {
        ...command.policy,
        reason: `当前为“每次询问”模式，命令执行前需要用户批准；${command.policy.reason}`,
      },
    });
  }
  if (command.risk === "high" || command.policy.decision === "requires_approval") {
    return describeAiCommandForApproval(command.command, {
      modelReason: command.reason,
      policy: {
        decision: "requires_approval",
        reason: command.risk === "high"
          ? `AI 将该命令标记为高风险；${command.policy.reason}`
          : command.policy.reason,
      },
    });
  }

  for (const segment of buildCommandQueue(input, command)) {
    const policy = evaluateAiCommand(segment.command);
    if (policy.decision === "deny") {
      return describeAiCommandForApproval(command.command, {
        modelReason: command.reason,
        policy,
      });
    }
    if (policy.decision === "requires_approval") {
      return describeAiCommandForApproval(command.command, {
        modelReason: command.reason,
        policy: {
          ...policy,
          reason: `子命令 ${segment.command} 需要确认；${policy.reason}`,
        },
      });
    }
  }
  return null;
}

function createPolicyRejectionFeedback(
  command: EvaluatedAiCommand,
  retryCount: number,
): LocalPolicyRejectionFeedback {
  return {
    type: "local_command_policy_rejection",
    retryCount,
    maxRetries: maxLocalPolicyRetries,
    command: command.command,
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

async function appendFinalExecutionSummary(
  input: AiChatInput,
  settings: AppSettings,
  signal: AbortSignal,
  emit: AgentEmitter | undefined,
  executedCommands: ExecutedAiCommandContext[],
  attachmentReads: AiAttachmentReadResult[],
  messages: AiMessage[],
): Promise<void> {
  const messageId = createId();
  const createdAt = Date.now() + 1;
  emit?.sendMessageStart(messageId, createdAt);
  const parsed = await requestAiTurn(
    input,
    settings,
    executedCommands,
    signal,
    emit ? text => emit.sendChunk(messageId, text) : undefined,
    undefined,
    attachmentReads,
    { toolsEnabled: false, finalSummary: true },
  );
  const latestResult = executedCommands.at(-1)?.result;
  const fallback = latestResult?.exitCode === 0
    ? "命令已成功执行，本轮自动操作已结束。请根据上方输出确认最终状态。"
    : "命令执行阶段已结束，请根据上方退出码和输出确认当前状态。";
  messages.push({
    id: messageId,
    role: "assistant",
    content: parsed.reply?.trim() || fallback,
    createdAt,
  });
  if (parsed.commands?.length) {
    writeAppLog({
      scope: "main.ai",
      level: "warn",
      message: "AI 最终总结阶段返回了命令调用，已忽略",
      data: { tabId: input.tabId, commandCount: parsed.commands.length },
    });
  }
}

function clearPendingApprovalsForConversation(
  conversationId: string,
  reason: string,
): void {
  for (const { id: approvalId, value: approval } of pendingApprovals.clearMatching(
    value => value.conversationId === conversationId,
  )) {
    const previousCard = approval.previousCards.find(card => card.id === approval.cardId);
    approval.emit?.sendCommandCard(
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

async function executeAgentCommand(
  input: AiChatInput,
  signal: AbortSignal,
  emit: AgentEmitter | undefined,
  command: EvaluatedAiCommand,
  commandCards: AiCommandCard[],
  executedCommands: ExecutedAiCommandContext[],
  attachmentReads: AiAttachmentReadResult[],
  messages: AiMessage[],
  options: {
    approvalId?: string;
    bypassApproval?: boolean;
    bypassPolicyDeny?: boolean;
    cardId?: string;
    cardCreatedAt?: number;
    approvalTtlMs?: number;
    commandTimeoutMs?: number;
  } = {},
): Promise<CommandExecutionResult> {
  const cardId = options.cardId ?? createId();
  const cardCreatedAt = options.cardCreatedAt ?? Date.now();
  let nextCards = commandCards;

  if (command.policy.decision === "deny" && !options.bypassPolicyDeny) {
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
    storePendingApproval(
      approvalId,
      {
        tabId: input.tabId,
        conversationId: input.conversationId,
        input,
        command,
        cardId,
        previousCards: nextCards,
        executedCommands,
        attachmentReads,
        createdAt: Date.now(),
        emit,
      },
      options.approvalTtlMs ?? 0,
    );
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
      timeoutMs: options.commandTimeoutMs ?? 10 * 60_000,
      signal,
    });
    const completedCard = result.timedOut
      ? createTimedOutCard(
          input,
          command,
          result,
          cardId,
          cardCreatedAt,
          options.approvalId,
        )
      : createCompletedCard(
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
    if (result.timedOut) {
      const timeoutMinutes = (options.commandTimeoutMs ?? 10 * 60_000) / 60_000;
      messages.push(
        createAssistantMessage(
          `命令执行已达到设置的 ${timeoutMinutes} 分钟超时，已向进程发送终止信号。本轮 AI 自动执行已停止，不会再次请求或重复执行该命令；请检查当前结果后再决定是否继续。`,
        ),
      );
      return { status: "return", result: { messages, commandCards: nextCards } };
    }
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
  initialAttachmentReads: AiAttachmentReadResult[] = [],
): Promise<AiChatResult> {
  const maxAgentCommandCount = settings.ai.maxAgentCommandCount;
  const commandTimeoutMs = settings.ai.commandTimeoutMinutes * 60_000;
  const approvalTtlMs = settings.ai.commandApprovalTimeoutMinutes * 60_000;
  const messages: AiMessage[] = [];
  let commandCards = [...previousCards];
  let executedCommands = [...initialExecutedCommands];
  let attachmentReads = [...initialAttachmentReads];
  const attachmentBufferCache = new Map<string, Buffer>();
  const readOffsets = new Set(
    attachmentReads.map(read => `${read.attachmentId}:${read.offset}`),
  );
  let policyFeedback: LocalPolicyRejectionFeedback | undefined;
  let localPolicyRetryCount = 0;

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
      policyFeedback,
      attachmentReads,
    );
    const reply = parsed.reply?.trim();
    const nextAttachmentRead = parsed.attachmentReads?.[0];
    if (nextAttachmentRead) {
      const readKey = `${nextAttachmentRead.attachmentId}:${nextAttachmentRead.offset}`;
      if (attachmentReads.length >= maxAttachmentReadCount) {
        messages.push({
          id: messageId,
          role: "assistant",
          content: [
            reply,
            `已达到单次任务最多 ${maxAttachmentReadCount} 次附件分段读取限制，请缩小问题范围或拆分附件后继续。`,
          ].filter(Boolean).join("\n\n"),
          createdAt: messageCreatedAt,
        });
        return { messages, commandCards };
      }
      if (readOffsets.has(readKey)) {
        messages.push({
          id: messageId,
          role: "assistant",
          content: [
            reply,
            "模型重复请求了同一附件的相同字节位置，已停止读取以避免无限循环。",
          ].filter(Boolean).join("\n\n"),
          createdAt: messageCreatedAt,
        });
        return { messages, commandCards };
      }
      try {
        const readResult = readAiAttachmentChunk(
          input.attachments ?? [],
          nextAttachmentRead,
          attachmentBufferCache,
        );
        attachmentReads.push(readResult);
        readOffsets.add(readKey);
        writeAppLog({
          scope: "main.ai",
          message: "AI 分段读取附件",
          data: {
            tabId: input.tabId,
            attachmentId: readResult.attachmentId,
            name: readResult.name,
            offset: readResult.offset,
            nextOffset: readResult.nextOffset,
            totalBytes: readResult.totalBytes,
            eof: readResult.eof,
            readCount: attachmentReads.length,
          },
        });
        continue;
      } catch (readError) {
        messages.push({
          id: messageId,
          role: "assistant",
          content: [
            reply,
            `附件分段读取失败：${readError instanceof Error ? readError.message : String(readError)}`,
          ].filter(Boolean).join("\n\n"),
          createdAt: messageCreatedAt,
        });
        return { messages, commandCards };
      }
    }
    const nextCommand = getNextParsedCommand(parsed);

    const defaultMessage = nextCommand
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

      const approvalId = createId();
      const approvalReason = describeAiCommandForApproval(nextCommand.command, {
        modelReason: nextCommand.reason,
        policy: {
          decision: "requires_approval",
          reason: `模型连续 ${maxLocalPolicyRetries} 次修正后仍被本地策略拦截（${nextCommand.policy.reason}）。批准后将按原样执行。`,
        },
      });
      const approvalCard = createApprovalCard(
        input,
        nextCommand,
        approvalId,
        createId(),
        Date.now(),
        approvalReason,
      );
      emit?.sendCommandCard(approvalCard);
      commandCards = mergeCards(commandCards, approvalCard);
      storePendingApproval(
        approvalId,
        {
          tabId: input.tabId,
          conversationId: input.conversationId,
          input,
          command: nextCommand,
          cardId: approvalCard.id,
          previousCards: commandCards,
          executedCommands,
          attachmentReads,
          createdAt: Date.now(),
          allowPolicyBypass: true,
          emit,
        },
        approvalTtlMs,
      );
      messages.push({
        id: messageId,
        role: "assistant",
        content: `${reply || defaultMessage}\n\n本地策略重试已耗尽，已转交人工审批。`,
        createdAt: messageCreatedAt,
      });
      return { messages, commandCards };
    }

    policyFeedback = undefined;
    localPolicyRetryCount = 0;
    const duplicateCommand = nextCommand
      ? findExecutedAiCommand(executedCommands, nextCommand.command)
      : undefined;
    if (nextCommand && duplicateCommand) {
      const previousResult = truncateText(
        formatCommandResultForPrompt(duplicateCommand.result),
        800,
      );
      messages.push({
        id: messageId,
        role: "assistant",
        content: [
          reply || defaultMessage,
          "检测到模型重复请求本轮已执行过的相同命令，已停止继续执行，避免重复重启、写入或产生其他副作用。",
          `上次执行结果：\n${previousResult}`,
        ].join("\n\n"),
        createdAt: messageCreatedAt,
      });
      writeAppLog({
        scope: "main.ai",
        level: "warn",
        message: "AI 重复命令已拦截",
        data: {
          tabId: input.tabId,
          command: nextCommand.command,
          executedCommandCount: executedCommands.length,
        },
      });
      return { messages, commandCards };
    }
    messages.push({
      id: messageId,
      role: "assistant",
      content: reply || defaultMessage,
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
      attachmentReads,
      messages,
      { approvalTtlMs, commandTimeoutMs },
    );
    if (execution.status === "return") return execution.result;
    commandCards = execution.commandCards;
    executedCommands = execution.executedCommands;
    if (
      shouldFinalizeAfterAiCommand(
        nextCommand,
        executedCommands.at(-1)?.result,
      )
    ) {
      await appendFinalExecutionSummary(
        input,
        settings,
        signal,
        emit,
        executedCommands,
        attachmentReads,
        messages,
      );
      return { messages, commandCards };
    }
  }

  messages.push(
    createAssistantMessage(
      `已达到单轮最多 ${maxAgentCommandCount} 条命令的限制，请根据当前结果继续提问。`,
    ),
  );
  return { messages, commandCards };
}

async function runTrackedRequest<T>(
  conversationId: string,
  tabId: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  activeRequests.get(conversationId)?.controller.abort();
  const controller = new AbortController();
  activeRequests.set(conversationId, { tabId, controller });
  try {
    return await operation(controller.signal);
  } finally {
    if (activeRequests.get(conversationId)?.controller === controller) {
      activeRequests.delete(conversationId);
    }
  }
}

export async function runAiChat(
  input: AiChatInput,
  settings: AppSettings,
  webContents?: WebContents,
): Promise<AiChatResult> {
  const emit = makeEmitter(input.tabId, input.conversationId, webContents);
  clearPendingApprovalsForConversation(
    input.conversationId,
    "已在当前 AI 会话中开始新的请求",
  );
  return runTrackedRequest(input.conversationId, input.tabId, async signal => {
    const prepared = await prepareAiChatInput(input, settings, signal);
    const result = await runAgentLoop(prepared.input, settings, signal, emit);
    return { ...result, compaction: prepared.compaction };
  });
}

export function cancelAiRequest(input: AiCancelInput): boolean {
  const request = activeRequests.get(input.conversationId);
  if (!request || request.tabId !== input.tabId) return false;
  request.controller.abort();
  writeAppLog({
    scope: "main.ai",
    message: "AI 请求已被用户终止",
    data: { tabId: input.tabId, conversationId: input.conversationId },
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
  const emit = makeEmitter(input.tabId, input.conversationId, webContents);

  return runTrackedRequest(input.conversationId, input.tabId, async signal => {
    let commandCards = approval.previousCards;
    let executedCommands = [...approval.executedCommands];
    const attachmentReads = [...approval.attachmentReads];
    const messages: AiMessage[] = [];
    const previousCard = commandCards.find(card => card.id === approval.cardId);
    const cardCreatedAt = previousCard?.createdAt ?? Date.now();
    const evaluatedCommand: EvaluatedAiCommand = {
      ...approval.command,
      reason: previousCard?.reason ?? approval.command.reason,
      policy: evaluateAiCommand(approval.command.command),
    };
    const execution = await executeAgentCommand(
      approval.input,
      signal,
      emit,
      evaluatedCommand,
      commandCards,
      executedCommands,
      attachmentReads,
      messages,
      {
        approvalId: input.approvalId,
        bypassApproval: true,
        bypassPolicyDeny: approval.allowPolicyBypass,
        cardId: approval.cardId,
        cardCreatedAt,
        commandTimeoutMs: settings.ai.commandTimeoutMinutes * 60_000,
      },
    );
    if (execution.status === "return") {
      return {
        ...execution.result,
        compaction: approval.input.compaction,
      };
    }
    commandCards = execution.commandCards;
    executedCommands = execution.executedCommands;
    if (
      shouldFinalizeAfterAiCommand(
        evaluatedCommand,
        executedCommands.at(-1)?.result,
      )
    ) {
      await appendFinalExecutionSummary(
        approval.input,
        settings,
        signal,
        emit,
        executedCommands,
        attachmentReads,
        messages,
      );
      return {
        messages,
        commandCards,
        compaction: approval.input.compaction,
      };
    }
    const loopResult = await runAgentLoop(
      approval.input,
      settings,
      signal,
      emit,
      commandCards,
      executedCommands,
      attachmentReads,
    );
    return {
      messages: [...messages, ...loopResult.messages],
      commandCards: loopResult.commandCards,
      compaction: approval.input.compaction,
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
  ) {
    return false;
  }
  if (!pendingApprovals.take(input.approvalId)) return false;
  writeAppLog({
    scope: "main.ai",
    message: "AI 命令授权已拒绝",
    data: {
      tabId: input.tabId,
      conversationId: input.conversationId,
      command: approval.command.command,
    },
  });
  return true;
}

export function disposeAiTabState(tabId: string): void {
  for (const [conversationId, request] of activeRequests) {
    if (request.tabId !== tabId) continue;
    request.controller.abort();
    activeRequests.delete(conversationId);
  }
  clearPendingApprovalsForTab(tabId, "终端标签页已关闭");
}
