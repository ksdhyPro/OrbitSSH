import type {
  AiCommandPolicyResult,
  AiMode,
} from "../../shared/ai.js";

export interface AiCommandPermissionResult {
  decision: "execute" | "requires_approval" | "deny";
  reason: string;
}

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
      reason: "逐命令审批模式要求确认每条命令",
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
