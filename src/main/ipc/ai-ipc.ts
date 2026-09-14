import { ipcMain } from "electron";

import {
  cancelAiRequest,
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
import { assertTabAccess } from "./validation.js";

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
    const normalizedInput = normalizeAiCancelInput(input);
    assertTabAccess(event, normalizedInput.tabId);
    return cancelAiRequest(normalizedInput);
  });
}
