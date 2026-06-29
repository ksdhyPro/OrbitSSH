import { ipcMain } from "electron";

import type {
  AiApprovedCommandInput,
  AiChatInput,
  AiRejectedCommandInput,
} from "../../shared/ai.js";
import { getSettings } from "../storage/settings-store.js";
import {
  rejectAiCommandApproval,
  runAiChat,
  runApprovedAiCommand,
} from "../ai/ai-agent.js";

export function registerAiIpc(): void {
  ipcMain.handle("ai:chat", (_event, input: AiChatInput) =>
    runAiChat(input, getSettings()),
  );

  ipcMain.handle("ai:run-approved-command", (_event, input: AiApprovedCommandInput) =>
    runApprovedAiCommand(input, getSettings()),
  );

  ipcMain.handle("ai:reject-command-approval", (_event, input: AiRejectedCommandInput) =>
    rejectAiCommandApproval(input),
  );
}
