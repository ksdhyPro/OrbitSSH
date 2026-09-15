import type { WebContents } from "electron";

import type {
  AiApprovedCommandInput,
  AiCancelInput,
  AiChatInput,
  AiChatResult,
  AiMessage,
  AiRejectedCommandInput,
} from "../../shared/ai.js";
import type { AppSettings } from "../../shared/settings.js";
import { writeAppLog } from "../logger.js";
import {
  cancelPendingApproval,
  createAssistantMessage,
  executeAgentAction,
  reevaluateAgentAction,
  type PendingApprovalState,
} from "./ai-agent-actions.js";
import {
  createAgentEmitter,
  type AgentEmitter,
} from "./ai-agent-events.js";
import {
  AiContextWindowExceededError,
  runAgentLoop,
} from "./ai-agent-runner.js";
import { ExpiringApprovalStore } from "./ai-approval-store.js";
import {
  AiConversationContextManager,
  calculateSummaryMaxTokens,
} from "./ai-context-budget.js";
import type { ExecutedAiCommandContext } from "./ai-context.js";
import { summarizeAiConversation } from "./ai-provider.js";

interface ActiveAiRequest {
  requestId: string;
  conversationId: string;
  controller: AbortController;
}

const approvalTtlMs = 5 * 60 * 1000;
const pendingApprovals = new ExpiringApprovalStore<PendingApprovalState>();
const activeRequests = new Map<string, ActiveAiRequest>();
const conversationContexts = new AiConversationContextManager();

function getActiveContextConfig(
  settings: AppSettings,
): { id: string; contextTokenLimitK: number } | null {
  if (!settings.ai.enabled) return null;
  const config =
    settings.ai.configs.find(item => item.id === settings.ai.activeConfigId) ??
    settings.ai.configs[0];
  if (!config?.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim()) {
    return null;
  }
  return {
    id: config.id,
    contextTokenLimitK: config.contextTokenLimitK,
  };
}

async function compressConversation(
  input: AiChatInput,
  settings: AppSettings,
  additionalMessages: AiMessage[],
  signal: AbortSignal,
): Promise<void> {
  const memory = conversationContexts.getMemory(input);
  const compressionInput: AiChatInput = {
    ...input,
    history: [
      ...conversationContexts.getSegmentHistory(input),
      ...additionalMessages,
    ],
  };

  try {
    const contextTokenLimitK =
      getActiveContextConfig(settings)?.contextTokenLimitK ?? 0;
    const summaryMaxTokens = contextTokenLimitK > 0
      ? calculateSummaryMaxTokens(
          compressionInput,
          memory,
          contextTokenLimitK,
        )
      : undefined;
    if (contextTokenLimitK > 0 && !summaryMaxTokens) {
      throw new Error("上下文剩余空间不足，无法生成安全的续接摘要");
    }
    const summary = await summarizeAiConversation(
      compressionInput,
      settings,
      memory.summary,
      summaryMaxTokens,
      signal,
    );
    conversationContexts.completeCompression(compressionInput, summary);
  } catch (error) {
    conversationContexts.failCompression(input);
    writeAppLog({
      scope: "main.ai",
      level: "error",
      message: "AI 上下文压缩失败",
      data: {
        tabId: input.tabId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw new Error("上下文压缩失败，本对话已停止继续请求模型。请新建对话后重试。");
  }
}

interface RunLoopWithContextOptions {
  input: AiChatInput;
  settings: AppSettings;
  signal: AbortSignal;
  emit?: AgentEmitter;
  previousCards?: AiChatResult["commandCards"];
  initialExecutedCommands?: ExecutedAiCommandContext[];
  leadingMessages?: AiMessage[];
}

/** 在 UI 对话不变的前提下管理内部上下文段，并只允许溢出后续接重试一次。 */
async function runLoopWithContext(
  options: RunLoopWithContextOptions,
): Promise<AiChatResult> {
  const { input, settings, signal, emit } = options;
  conversationContexts.assertAvailable(input);
  const activeContextConfig = getActiveContextConfig(settings);
  const contextTokenLimitK = activeContextConfig?.contextTokenLimitK ?? 0;
  const configId = activeContextConfig?.id ?? "";
  let leadingMessages = [...(options.leadingMessages ?? [])];
  let previousCards = options.previousCards;
  let initialExecutedCommands = options.initialExecutedCommands ?? [];
  let retriedAfterCompression = false;
  let compressedDuringRun = false;

  if (
    conversationContexts.shouldCompress(
      input,
      contextTokenLimitK,
      configId,
    )
  ) {
    await compressConversation(input, settings, leadingMessages, signal);
    compressedDuringRun = true;
  }

  while (true) {
    try {
      const result = await runAgentLoop({
        input,
        settings,
        signal,
        emit,
        previousCards,
        initialExecutedCommands,
        prepareContext: async (loopMessages, executedCommands) => {
          const additionalMessages = [...leadingMessages, ...loopMessages];
          const budgetInput: AiChatInput = {
            ...input,
            history: [
              ...conversationContexts.getSegmentHistory(input),
              ...additionalMessages,
            ],
          };
          if (
            !compressedDuringRun &&
            conversationContexts.shouldCompress(
              budgetInput,
              contextTokenLimitK,
              configId,
            )
          ) {
            await compressConversation(
              input,
              settings,
              additionalMessages,
              signal,
            );
            compressedDuringRun = true;
          }

          const currentCommandIds = new Set(
            executedCommands.map(command => command.toolCallId),
          );
          const memory = conversationContexts.getMemory(input);
          memory.commands = memory.commands.filter(
            command => !currentCommandIds.has(command.toolCallId),
          );
          return {
            input: {
              ...input,
              history: conversationContexts.getSegmentHistory(input),
            },
            memory,
          };
        },
        onTokenUsage: usage =>
          conversationContexts.recordUsage(input, usage, configId),
        onCommandExecuted: command => conversationContexts.recordCommand(input, command),
        storeApproval: storePendingApproval,
      });
      return {
        messages: [...leadingMessages, ...result.messages],
        commandCards: result.commandCards,
        contextUsage: activeContextConfig
          ? conversationContexts.getContextUsage(
              input,
              configId,
              contextTokenLimitK,
            )
          : undefined,
      };
    } catch (error) {
      if (!(error instanceof AiContextWindowExceededError)) throw error;

      error.executedCommands.forEach(command =>
        conversationContexts.recordCommand(input, command),
      );
      leadingMessages = [...leadingMessages, ...error.messages];
      previousCards = error.commandCards;
      initialExecutedCommands = [];

      if (retriedAfterCompression) {
        conversationContexts.failCompression(input);
        return {
          messages: [
            ...leadingMessages,
            createAssistantMessage(
              "上下文压缩后重试仍超过模型窗口，本对话已停止。请新建对话后继续。",
            ),
          ],
          commandCards: previousCards,
          contextUsage: activeContextConfig
            ? conversationContexts.getContextUsage(
                input,
                configId,
                contextTokenLimitK,
              )
            : undefined,
        };
      }

      await compressConversation(input, settings, leadingMessages, signal);
      retriedAfterCompression = true;
      compressedDuringRun = true;
    }
  }
}

function notifyExpiredApproval(
  approvalId: string,
  approval: PendingApprovalState,
): void {
  cancelPendingApproval(approvalId, approval, "命令授权已过期");
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
  for (const { id, value } of pendingApprovals.clearForTab(tabId)) {
    cancelPendingApproval(id, value, reason, emit);
  }
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

/** 启动新对话请求；同标签页旧请求和待审批动作会被终止。 */
export async function runAiChat(
  input: AiChatInput,
  settings: AppSettings,
  webContents?: WebContents,
): Promise<AiChatResult> {
  const emit = createAgentEmitter(input, webContents);
  clearPendingApprovalsForTab(input.tabId, "已开始新的 AI 请求", emit);
  return runTrackedRequest(input, signal =>
    runLoopWithContext({
      input,
      settings,
      signal,
      emit,
    }),
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

/** 消费一次性审批并继续原 Agent 循环。 */
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
    approval.displayCommand !== input.command.trim()
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
  const emit = createAgentEmitter(resumedInput, webContents);

  return runTrackedRequest(resumedInput, async signal => {
    const action = reevaluateAgentAction(approval.action);
    const messages: AiMessage[] = [];
    const previousCard = approval.previousCards.find(
      card => card.id === approval.cardId,
    );
    const execution = await executeAgentAction({
      input: resumedInput,
      signal,
      emit,
      action,
      commandCards: approval.previousCards,
      executedCommands: [...approval.executedCommands],
      messages,
      storeApproval: storePendingApproval,
      onCommandExecuted: command =>
        conversationContexts.recordCommand(resumedInput, command),
      approval: {
        id: input.approvalId,
        cardId: approval.cardId,
        cardCreatedAt: previousCard?.createdAt ?? Date.now(),
      },
    });
    if (execution.status === "return") return execution.result;

    const loopResult = await runLoopWithContext({
      input: resumedInput,
      settings,
      signal,
      emit,
      previousCards: execution.commandCards,
      initialExecutedCommands: execution.executedCommands,
      leadingMessages: messages,
    });
    return loopResult;
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
    data: { tabId: input.tabId, commandLength: approval.displayCommand.length },
  });
  return true;
}

export function disposeAiTabState(tabId: string): void {
  activeRequests.get(tabId)?.controller.abort();
  activeRequests.delete(tabId);
  clearPendingApprovalsForTab(tabId, "终端标签页已关闭");
  conversationContexts.clearTab(tabId);
}
