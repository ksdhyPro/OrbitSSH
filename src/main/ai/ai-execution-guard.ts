import type { AiCommandPolicyResult, AiCommandResult } from "../../shared/ai.js";

interface CompletedAiCommand {
  risk: "low" | "medium" | "high";
  policy: AiCommandPolicyResult;
}

/** A successful write/state-changing command ends this task's execution phase. */
export function shouldFinalizeAfterAiCommand(
  command: CompletedAiCommand,
  result: AiCommandResult | undefined,
): boolean {
  if (!result || result.timedOut || result.exitCode !== 0) return false;
  return command.risk !== "low" || command.policy.decision !== "allow_readonly";
}
