import type { AiCommandPolicyResult, AiMode } from "../../shared/ai.js";

export interface AiCommandPermissionResult {
  decision: "execute" | "requires_approval" | "deny";
  reason: string;
}

export const CROSS_SERVER_OPERATIONS_DISABLED_REASON =
  "全局 AI 设置未允许跨服务器执行操作";
export const CROSS_SERVER_OPERATIONS_DISABLED_MESSAGE =
  "已阻止跨服务器操作：全局“AI → 是否允许跨服务器执行操作”当前处于关闭状态。如需使用，请先在设置中开启。开启后，每次跨服务器命令仍需单独确认。";

/**
 * 在一个稳定接口内合并授权档位、模型风险标记和本地命令策略。
 * 用户批准只能跳过审批，不能绕过格式无效等 deny 结果。
 */
export function resolveAiCommandPermission(
  mode: AiMode,
  risk: "low" | "medium" | "high",
  policy: AiCommandPolicyResult,
  approvalGranted = false,
): AiCommandPermissionResult {
  if (policy.decision === "deny") {
    return { decision: "deny", reason: policy.reason };
  }

  if (approvalGranted) {
    return { decision: "execute", reason: "用户已批准本次命令" };
  }

  if (mode === "full_access") {
    return { decision: "execute", reason: "完全访问模式直接执行" };
  }

  if (mode === "ask") {
    return {
      decision: "requires_approval",
      reason: "请求批准模式要求确认每条命令",
    };
  }

  if (risk === "high") {
    return {
      decision: "requires_approval",
      reason: "命令被模型标记为高风险操作",
    };
  }

  if (policy.decision === "requires_approval") {
    return { decision: "requires_approval", reason: policy.reason };
  }

  return { decision: "execute", reason: policy.reason };
}

/** 已保存服务器属于额外执行目标，任何模式都必须由用户逐次明确批准。 */
export function resolveSavedServerCommandPermission(
  allowCrossServerOperations: boolean,
  mode: AiMode,
  risk: "low" | "medium" | "high",
  policy: AiCommandPolicyResult,
  approvalGranted = false,
): AiCommandPermissionResult {
  // 跨服务器总开关优先于命令策略和用户审批，任何权限档位都不能绕过。
  if (!allowCrossServerOperations) {
    return {
      decision: "deny",
      reason: CROSS_SERVER_OPERATIONS_DISABLED_REASON,
    };
  }
  if (policy.decision === "deny") {
    return { decision: "deny", reason: policy.reason };
  }
  if (!approvalGranted) {
    return {
      decision: "requires_approval",
      reason: "跨服务器命令必须由用户明确批准本次执行",
    };
  }
  return resolveAiCommandPermission(mode, risk, policy, true);
}
