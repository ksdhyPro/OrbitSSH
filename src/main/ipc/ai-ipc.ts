import { ipcMain } from "electron";

import type {
  AiApprovedCommandInput,
  AiCancelInput,
  AiChatInput,
  AiRejectedCommandInput,
} from "../../shared/ai.js";
import { getSettings } from "../storage/settings-store.js";
import {
  cancelAiRequest,
  rejectAiCommandApproval,
  runAiChat,
  runApprovedAiCommand,
} from "../ai/ai-agent.js";
import {
  assertTabAccess,
  requireNonEmptyString,
  requireRecord,
} from "./validation.js";

function requireInputTabId(input: unknown, label: string): string {
  const record = requireRecord(input, label);

  return requireNonEmptyString(record.tabId, "终端标签页 ID");
}

function normalizeRejectedApprovalInput(input: unknown): AiRejectedCommandInput {
  const record = requireRecord(input, "拒绝授权参数");

  return {
    approvalId: requireNonEmptyString(record.approvalId, "授权 ID"),
  };
}

export function registerAiIpc(): void {
  ipcMain.handle("ai:chat", (event, input: unknown) => {
    const tabId = requireInputTabId(input, "AI 对话参数");
    assertTabAccess(event, tabId);

    return runAiChat(input as AiChatInput, getSettings(), event.sender);
  });

  ipcMain.handle("ai:run-approved-command", (event, input: unknown) => {
    const tabId = requireInputTabId(input, "AI 授权命令参数");
    assertTabAccess(event, tabId);

    return runApprovedAiCommand(
      input as AiApprovedCommandInput,
      getSettings(),
      event.sender,
    );
  });

  ipcMain.handle("ai:reject-command-approval", (_event, input: unknown) =>
    rejectAiCommandApproval(normalizeRejectedApprovalInput(input)),
  );

  ipcMain.handle("ai:cancel", (event, input: unknown) => {
    const tabId = requireInputTabId(input, "AI 取消参数");
    assertTabAccess(event, tabId);

    return cancelAiRequest(input as AiCancelInput);
  });
}
