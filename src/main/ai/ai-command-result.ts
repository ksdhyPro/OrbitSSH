import type { AiCommandResult, AiCommandStatus } from "../../shared/ai.js";

/** 把所有命令适配器的结果统一映射为命令卡终态。 */
export function getAiCommandResultStatus(
  result: AiCommandResult,
): Extract<AiCommandStatus, "completed" | "failed"> {
  return result.exitCode === 0 && !result.timedOut ? "completed" : "failed";
}

/** 为失败命令生成稳定且可读的命令卡错误说明。 */
export function getAiCommandResultError(
  result: AiCommandResult,
): string | undefined {
  if (result.exitCode === 0 && !result.timedOut) return undefined;
  if (result.timedOut) return "命令执行超时";
  return `命令以退出码 ${String(result.exitCode ?? "未知")} 结束`;
}
