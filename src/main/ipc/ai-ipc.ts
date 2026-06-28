import { ipcMain } from "electron";

import type {
  AiApprovedCommandInput,
  AiChatInput,
  AiCommandApprovalInput,
} from "../../shared/ai.js";
import { getSettings } from "../storage/settings-store.js";
import { runAiChat } from "../ai/ai-agent.js";
import {
  requestAiCommandApproval,
  runApprovedAiCommand,
  runReadonlyAiCommand,
} from "../ai/ai-tools.js";

export function registerAiIpc(): void {
  ipcMain.handle("ai:chat", (_event, input: AiChatInput) =>
    runAiChat(input, getSettings()),
  );

  ipcMain.handle("ai:run-readonly-command", (_event, tabId: string, command: string) =>
    runReadonlyAiCommand(tabId, command),
  );

  ipcMain.handle("ai:request-command-approval", (_event, input: AiCommandApprovalInput) =>
    requestAiCommandApproval(input),
  );

  ipcMain.handle("ai:run-approved-command", (_event, input: AiApprovedCommandInput) =>
    runApprovedAiCommand(input),
  );
}
