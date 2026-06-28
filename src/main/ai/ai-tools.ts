import type {
  AiApprovedCommandInput,
  AiCommandApprovalInput,
  AiCommandCard,
  AiCommandResult,
} from "../../shared/ai.js";
import { writeAppLog } from "../logger.js";
import { executeTerminalCommand } from "../ssh/session-manager.js";
import { evaluateAiCommand } from "./command-policy.js";

const APPROVAL_TTL_MS = 5 * 60 * 1000;

interface StoredApproval {
  tabId: string;
  command: string;
  expiresAt: number;
}

const approvals = new Map<string, StoredApproval>();

function createId(): string {
  return crypto.randomUUID();
}

function summarizeOutput(result: AiCommandResult): Record<string, unknown> {
  const text = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    outputPreview: text.slice(0, 1200),
  };
}

export async function runReadonlyAiCommand(
  tabId: string,
  command: string,
): Promise<AiCommandResult> {
  const policy = evaluateAiCommand(command);

  writeAppLog({
    scope: "main.ai",
    message: "AI readonly command policy evaluated",
    data: { tabId, command, policy },
  });

  if (policy.decision !== "allow_readonly") {
    throw new Error(policy.reason);
  }

  const result = await executeTerminalCommand(tabId, command, 12_000);

  writeAppLog({
    scope: "main.ai",
    message: "AI readonly command executed",
    data: { tabId, command, ...summarizeOutput(result) },
  });

  return result;
}

export function requestAiCommandApproval(
  input: AiCommandApprovalInput,
): AiCommandCard {
  const approvalId = createId();
  approvals.set(approvalId, {
    tabId: input.tabId,
    command: input.command.trim(),
    expiresAt: Date.now() + APPROVAL_TTL_MS,
  });

  writeAppLog({
    scope: "main.ai",
    message: "AI command approval requested",
    data: {
      tabId: input.tabId,
      command: input.command,
      reason: input.reason,
      risk: input.risk,
    },
  });

  return {
    id: createId(),
    tabId: input.tabId,
    command: input.command,
    reason: input.reason,
    risk: input.risk,
    status: "requires_approval",
    approvalId,
  };
}

export async function runApprovedAiCommand(
  input: AiApprovedCommandInput,
): Promise<AiCommandResult> {
  const approval = approvals.get(input.approvalId);

  if (!approval) {
    throw new Error("Command approval is missing or already used");
  }

  approvals.delete(input.approvalId);

  if (approval.expiresAt < Date.now()) {
    throw new Error("Command approval expired");
  }

  if (approval.tabId !== input.tabId || approval.command !== input.command.trim()) {
    throw new Error("Command approval does not match this command");
  }

  const result = await executeTerminalCommand(input.tabId, input.command, 20_000);

  writeAppLog({
    scope: "main.ai",
    message: "AI approved command executed",
    data: { tabId: input.tabId, command: input.command, ...summarizeOutput(result) },
  });

  return result;
}

export { evaluateAiCommand };
