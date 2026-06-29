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

export function registerAiIpc(): void {
  ipcMain.handle("ai:chat", (event, input: AiChatInput) =>
    runAiChat(input, getSettings(), event.sender),
  );

  ipcMain.handle("ai:run-approved-command", (event, input: AiApprovedCommandInput) =>
    runApprovedAiCommand(input, getSettings(), event.sender),
  );

  ipcMain.handle("ai:reject-command-approval", (_event, input: AiRejectedCommandInput) =>
    rejectAiCommandApproval(input),
  );

  ipcMain.handle("ai:cancel", (_event, input: AiCancelInput) =>
    cancelAiRequest(input),
  );
}
