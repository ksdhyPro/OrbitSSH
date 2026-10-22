import type { AiCommandPolicyResult } from "../../shared/ai.js";
import { evaluateAiCommandDataExposure } from "./ai-data-policy.js";
import {
  COMMAND_WRAPPERS,
  CRITICAL_APPROVAL_PREFIXES,
  DESTRUCTIVE_COMMANDS,
  FIREWALL_COMMAND_PATTERN,
  INDIRECT_EXECUTION_COMMANDS,
  INDIRECT_EXECUTION_PATTERN,
  isReadonlyFirewallCommand,
  MUST_APPROVE_DESTRUCTIVE_PATTERNS,
  MUST_APPROVE_DOCKER_PATTERNS,
  MUST_APPROVE_GENERAL_PATTERNS,
  MUST_APPROVE_PACKAGE_PATTERNS,
  MUST_APPROVE_SERVICE_PATTERNS,
  REMOTE_SHELL_COMMAND_PATTERN,
  SHELL_KEYWORDS,
} from "./command-policy-rules.js";
import { isAutoAllowedQueryCommand, VERSION_QUERY_PATTERN } from "./command-readonly.js";
import { getWriteRiskReason } from "./command-write-risk.js";
import {
  getCommandValidationError,
  getEffectiveCommand,
  getUnsupportedShellStructureReason,
  normalizeCommand,
  readShellTokens,
  splitAiShellCommands,
} from "./shell-syntax.js";

// 保持原有导出，调用方和测试无需改动。
export { isAutoAllowedQueryCommand } from "./command-readonly.js";
export { splitAiShellCommands, type ShellCommandSegment } from "./shell-syntax.js";

function getMandatoryApprovalReason(
  command: string,
  risk: "low" | "medium" | "high" = "medium",
): string | null {
  const normalized = normalizeCommand(command);
  const effective = getEffectiveCommand(normalized);

  if (!normalized) {
    return "命令为空";
  }

  if (risk === "high") {
    return "AI 标记为高风险命令";
  }

  if (/\r|\n/.test(command)) {
    return "检测到多行 Shell 命令";
  }

  const commandName = effective.commandName;

  if (REMOTE_SHELL_COMMAND_PATTERN.test(command)) {
    return "检测到 SSH、SCP 或 SFTP 跨服务器命令";
  }

  // python3 --version 等纯版本查询不会执行脚本，不按解释器间接执行处理。
  if (
    !VERSION_QUERY_PATTERN.test(normalized) &&
    (INDIRECT_EXECUTION_COMMANDS.has(commandName) || INDIRECT_EXECUTION_PATTERN.test(command))
  ) {
    return "命令通过 Shell、解释器或批处理包装器间接执行，必须确认";
  }

  if (/\$\(|`/.test(command)) {
    return "命令包含动态命令替换，必须确认";
  }

  if (CRITICAL_APPROVAL_PREFIXES.includes(commandName)) {
    return "命中高风险命令前缀";
  }

  if (
    MUST_APPROVE_PACKAGE_PATTERNS.some(pattern => pattern.test(effective.normalized)) ||
    MUST_APPROVE_DOCKER_PATTERNS.some(pattern => pattern.test(effective.normalized)) ||
    MUST_APPROVE_SERVICE_PATTERNS.some(pattern => pattern.test(effective.normalized)) ||
    MUST_APPROVE_DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(effective.normalized)) ||
    MUST_APPROVE_GENERAL_PATTERNS.some(pattern => pattern.test(effective.normalized))
  ) {
    return "命中本地高风险命令黑名单";
  }

  return null;
}

export function isReadonlyAllowedCommand(command: string): boolean {
  return isAutoAllowedQueryCommand(command);
}

/** 当前终端禁止通过任何常见包装形式发起跨服务器 Shell。 */
export function containsRemoteShellCommand(command: string): boolean {
  return REMOTE_SHELL_COMMAND_PATTERN.test(command);
}

export function requiresMandatoryApproval(
  command: string,
  risk: "low" | "medium" | "high" = "medium",
): boolean {
  if (risk === "high") return true;
  const decision = evaluateAiCommand(command).decision;
  return decision === "requires_approval" || decision === "deny";
}

export function evaluateAiCommand(command: string): AiCommandPolicyResult {
  const validationError = getCommandValidationError(command);
  if (validationError) {
    return { decision: "deny", reason: validationError };
  }
  const normalized = normalizeCommand(command);

  if (!normalized) {
    return { decision: "deny", reason: "命令为空" };
  }

  // 只读不代表可安全外发，凭据源和敏感查询必须先经过独立的数据暴露策略。
  const dataExposure = evaluateAiCommandDataExposure(command);
  if (dataExposure.decision === "deny") {
    return { decision: "deny", reason: dataExposure.reason };
  }
  if (dataExposure.decision === "requires_approval") {
    return { decision: "requires_approval", reason: dataExposure.reason };
  }

  const structureReason = getUnsupportedShellStructureReason(command);
  if (structureReason) {
    return { decision: "requires_approval", reason: structureReason };
  }

  // 按 ;、&&、|| 和管道拆分后逐段审查，任一段需要审批或被拒绝时整条命令同样处理。
  const compoundSegments = splitAiShellCommands(command);
  if (compoundSegments.length > 1) {
    const decisions = compoundSegments.map(segment => evaluateAiCommand(segment.command));
    const denied = decisions.find(item => item.decision === "deny");
    if (denied) return denied;
    const approval = decisions.find(item => item.decision === "requires_approval");
    if (approval) return approval;
    return isAutoAllowedQueryCommand(command)
      ? {
          decision: "allow_readonly",
          reason: "复合命令均命中只读白名单",
        }
      : {
          decision: "allow_autonomous",
          reason: "复合命令未命中高风险规则，可在自主执行模式运行",
        };
  }

  const effective = getEffectiveCommand(normalized);
  const firstToken = readShellTokens(normalized)[0]?.value ?? "";

  if (SHELL_KEYWORDS.has(firstToken) || firstToken === "{" || firstToken === "}") {
    return {
      decision: "requires_approval",
      reason: "命令包含 Shell 控制结构，本地策略无法逐段审查",
    };
  }

  if (
    CRITICAL_APPROVAL_PREFIXES.includes(effective.commandName) ||
    DESTRUCTIVE_COMMANDS.has(effective.commandName) ||
    /^(mkfs|fsck)(\.|$)/.test(effective.commandName)
  ) {
    return {
      decision: "requires_approval",
      reason: "检测到高危命令前缀，必须确认",
    };
  }

  if (COMMAND_WRAPPERS.has(effective.commandName)) {
    return {
      decision: "requires_approval",
      reason: "命令通过包装器执行其他命令，必须确认",
    };
  }

  if (
    FIREWALL_COMMAND_PATTERN.test(effective.normalized) &&
    !isReadonlyFirewallCommand(effective.normalized)
  ) {
    return {
      decision: "requires_approval",
      reason: "防火墙变更可能切断当前连接，必须确认",
    };
  }

  const writeRiskReason = getWriteRiskReason(normalized);
  if (writeRiskReason) {
    return { decision: "requires_approval", reason: writeRiskReason };
  }

  const mandatoryApprovalReason = getMandatoryApprovalReason(command);
  if (mandatoryApprovalReason) {
    return {
      decision: "requires_approval",
      reason: mandatoryApprovalReason,
    };
  }

  if (isAutoAllowedQueryCommand(command)) {
    return {
      decision: "allow_readonly",
      reason: "命中本地只读命令白名单",
    };
  }

  return {
    decision: "allow_autonomous",
    reason: "命令未命中高风险规则，可在自主执行模式运行",
  };
}
