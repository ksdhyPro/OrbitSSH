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
  executeAgentAction,
  reevaluateAgentAction,
  type PendingApprovalState,
} from "./ai-agent-actions.js";
import {
  createAgentEmitter,
  type AgentEmitter,
} from "./ai-agent-events.js";
import { runAgentLoop } from "./ai-agent-runner.js";
import { ExpiringApprovalStore } from "./ai-approval-store.js";

interface ActiveAiRequest {
  requestId: string;
  conversationId: string;
  controller: AbortController;
}

const approvalTtlMs = 5 * 60 * 1000;
const pendingApprovals = new ExpiringApprovalStore<PendingApprovalState>();
const activeRequests = new Map<string, ActiveAiRequest>();

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
    runAgentLoop({
      input,
      settings,
      signal,
      emit,
      storeApproval: storePendingApproval,
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
      approval: {
        id: input.approvalId,
        cardId: approval.cardId,
        cardCreatedAt: previousCard?.createdAt ?? Date.now(),
      },
    });
    if (execution.status === "return") return execution.result;

    const loopResult = await runAgentLoop({
      input: resumedInput,
      settings,
      signal,
      emit,
      previousCards: execution.commandCards,
      initialExecutedCommands: execution.executedCommands,
      storeApproval: storePendingApproval,
    });
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
}
