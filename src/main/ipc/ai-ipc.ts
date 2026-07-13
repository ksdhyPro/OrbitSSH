import { ipcMain } from "electron";

import type { AiCancelInput } from "../../shared/ai.js";
import {
  cancelAiRequest,
  rejectAiCommandApproval,
  runAiChat,
  runApprovedAiCommand,
} from "../ai/ai-agent.js";
import {
  normalizeAiChatInput,
  normalizeApprovedCommandInput,
  normalizeRejectedApprovalInput,
} from "../ai/ai-input.js";
import { getSettings } from "../storage/settings-store.js";
import {
  assertTabAccess,
  requireNonEmptyString,
  requireRecord,
} from "./validation.js";

function requireInputTabId(input: unknown, label: string): string {
  const record = requireRecord(input, label);
  return requireNonEmptyString(record.tabId, "终端标签页 ID");
}

export function registerAiIpc(): void {
  ipcMain.handle("ai:chat", (event, input: unknown) => {
    const normalizedInput = normalizeAiChatInput(input);
    assertTabAccess(event, normalizedInput.tabId);
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
    const tabId = requireInputTabId(input, "AI 取消参数");
    assertTabAccess(event, tabId);
    return cancelAiRequest({ tabId } satisfies AiCancelInput);
  });
}
