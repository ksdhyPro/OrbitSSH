import { ipcMain } from "electron";

import {
  cancelAiRequest,
  disposeAiConversationState,
  rejectAiCommandApproval,
  runAiChat,
  runApprovedAiCommand,
} from "../ai/ai-agent.js";
import {
  normalizeAiChatInput,
  normalizeAiCancelInput,
  normalizeApprovedCommandInput,
  normalizeRejectedApprovalInput,
} from "../ai/ai-input.js";
import { getSettings } from "../storage/settings-store.js";
import { getTerminalContextSnapshot } from "../ssh/session-manager.js";
import {
  deleteConversation,
  getConversationRecord,
  listConversationSummaries,
} from "../storage/ai-conversation-store.js";
import { assertTabAccess } from "./validation.js";

export function registerAiIpc(): void {
  // 历史对话按 serverId 分区存取，与终端标签页生命周期无关。
  ipcMain.handle("ai:conversations:list", (_event, serverId: string) =>
    listConversationSummaries(serverId),
  );

  ipcMain.handle(
    "ai:conversations:get",
    (_event, serverId: string, conversationId: string) =>
      getConversationRecord(serverId, conversationId),
  );

  ipcMain.handle(
    "ai:conversations:delete",
    (_event, serverId: string, conversationId: string) => {
      const deleted = deleteConversation(serverId, conversationId);
      if (deleted) disposeAiConversationState(serverId, conversationId);
      return deleted;
    },
  );

  ipcMain.handle("ai:chat", (event, input: unknown) => {
    const normalizedInput = normalizeAiChatInput(input);
    assertTabAccess(event, normalizedInput.tabId);
    const terminalContext = getTerminalContextSnapshot(normalizedInput.tabId);
    if (terminalContext?.serverId !== normalizedInput.context.serverId) {
      throw new Error("AI 上下文服务器与当前终端不匹配");
    }
    return runAiChat(normalizedInput, getSettings(), event.sender);
  });

  ipcMain.handle("ai:run-approved-command", (event, input: unknown) => {
    const normalizedInput = normalizeApprovedCommandInput(input);
    assertTabAccess(event, normalizedInput.tabId);
    return runApprovedAiCommand(normalizedInput, getSettings(), event.sender);
  });

  ipcMain.handle("ai:reject-command-approval", (event, input: unknown) => {
    const normalizedInput = normalizeRejectedApprovalInput(input);
    assertTabAccess(event, normalizedInput.tabId);
    return rejectAiCommandApproval(normalizedInput);
  });

  ipcMain.handle("ai:cancel", (event, input: unknown) => {
    const normalizedInput = normalizeAiCancelInput(input);
    assertTabAccess(event, normalizedInput.tabId);
    return cancelAiRequest(normalizedInput);
  });
}
