import type { AiCommandPolicyResult } from "../../shared/ai.js";

const DANGEROUS_TOKENS = [
  "sudo",
  ">",
  "<",
  "&&",
  "||",
  ";",
  "`",
  "$(",
  "&",
];

const DENIED_PREFIXES = [
  "rm",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "poweroff",
  "halt",
];

const MUST_APPROVE_PREFIXES = [
  ...DENIED_PREFIXES,
  "useradd",
  "userdel",
  "usermod",
  "passwd",
  "chmod",
  "chown",
];

const MUST_APPROVE_PACKAGE_PATTERNS = [
  /^(apt|apt-get|yum|dnf|pacman|zypper|brew)\s+(install|remove|erase|purge|upgrade|dist-upgrade|update|autoremove|clean|reinstall)\b/,
  /^(npm|pnpm|yarn)\s+(install|add|remove|uninstall|update|upgrade|run|exec|create|init|publish|link|unlink)\b/,
  /^(pip|pip3)\s+(install|uninstall|download|wheel)\b/,
];

const MUST_APPROVE_DOCKER_PATTERNS = [
  /^docker\s+(rm|rmi|stop|restart|kill|exec)\b/,
  /^docker\s+compose\s+(down|restart|stop|rm|exec)\b/,
];

const MUST_APPROVE_SERVICE_PATTERNS = [
  /^(systemctl|service)\s+\S+\s+(stop|restart|reload|disable|enable)\b/,
  /^systemctl\s+(stop|restart|reload|disable|enable)\s+\S+/,
];

const SAFE_ARG = "[A-Za-z0-9_./:@%+=,~*?-]+";
const SAFE_TEXT = "['\"]?[^'\";&|<>`$]{1,160}['\"]?";

const READONLY_PATTERNS: RegExp[] = [
  /^pwd$/,
  /^whoami$/,
  /^id(?:\s+[A-Za-z0-9_.-]+)?$/,
  /^hostname$/,
  /^uname\s+-a$/,
  /^date$/,
  /^uptime$/,
  /^locale$/,
  /^cat\s+\/etc\/os-release$/,
  /^lsb_release\s+-a$/,
  /^hostnamectl$/,
  /^sw_vers$/,
  /^ver$/,
  /^df\s+-h$/,
  /^du\s+-sh\s+\.$/,
  new RegExp(`^du\\s+-sh\\s+${SAFE_ARG}$`),
  /^free\s+-h$/,
  /^vm_stat$/,
  /^top\s+-bn1$/,
  /^ps\s+(aux|-ef)$/,
  /^pgrep\s+(-a\s+)?[A-Za-z0-9_.:@%+=,~*?-]+$/,
  /^lsof\s+(-i(?::\d{1,5})?|-p\s+\d+|[A-Za-z0-9_./:@%+=,~*?-]+)$/,
  /^ip\s+(addr|route)$/,
  /^ip\s+(addr|route)\s+show$/,
  /^ifconfig$/,
  /^ss\s+-[A-Za-zlnptu]+$/,
  /^netstat\s+-[A-Za-zlnptu]+$/,
  /^ping\s+-c\s+4\s+[A-Za-z0-9_.:-]+$/,
  /^curl\s+-I\s+https?:\/\/\S+$/,
  /^nslookup\s+[A-Za-z0-9_.:-]+$/,
  /^dig\s+[A-Za-z0-9_.:-]+$/,
  new RegExp(`^ls(?:\\s+-[A-Za-z0-9A-Z@,._-]+)*(?:\\s+${SAFE_ARG})?$`),
  new RegExp(`^find\\s+${SAFE_ARG}\\s+-maxdepth\\s+[1-5](?:\\s+-type\\s+[fdl])?(?:\\s+-name\\s+${SAFE_TEXT})?$`),
  new RegExp(`^stat\\s+${SAFE_ARG}$`),
  new RegExp(`^file\\s+${SAFE_ARG}$`),
  new RegExp(`^wc\\s+(-l|-c|-m|-w)\\s+${SAFE_ARG}$`),
  new RegExp(`^head(?:\\s+-n\\s+\\d{1,4})?\\s+${SAFE_ARG}$`),
  new RegExp(`^tail\\s+-n\\s+\\d{1,4}\\s+${SAFE_ARG}$`),
  new RegExp(`^cat\\s+${SAFE_ARG}$`),
  new RegExp(`^grep\\s+(?:-[A-Za-z]{1,6}\\s+)?${SAFE_TEXT}\\s+${SAFE_ARG}$`),
  /^systemctl\s+status\s+[A-Za-z0-9_.@-]+$/,
  /^systemctl\s+is-active\s+[A-Za-z0-9_.@-]+$/,
  /^systemctl\s+list-(units|timers|sockets|services)(?:\s+--all)?(?:\s+--no-pager)?$/,
  /^journalctl\s+-u\s+[A-Za-z0-9_.@-]+\s+-n\s+\d{1,4}\s+--no-pager$/,
  /^service\s+[A-Za-z0-9_.@-]+\s+status$/,
  /^docker\s+ps(?:\s+-a)?(?:\s+--format\s+['"]?[^;&|<>`$]{1,120}['"]?)?$/,
  /^docker\s+images$/,
  /^docker\s+logs\s+--tail\s+\d{1,4}\s+[A-Za-z0-9_.-]+$/,
  /^docker\s+inspect\s+[A-Za-z0-9_.-]+$/,
  /^docker\s+stats\s+--no-stream$/,
  /^docker\s+compose\s+ps$/,
  /^docker\s+compose\s+logs\s+--tail\s+\d{1,4}(?:\s+[A-Za-z0-9_.-]+)?$/,
  /^git\s+status$/,
  /^git\s+log\s+--oneline\s+-n\s+\d{1,3}$/,
  /^git\s+branch$/,
  /^git\s+remote\s+-v$/,
  /^git\s+diff(?:\s+--stat)?$/,
  /^(apt|apt-get)\s+(list|show|policy)\b(?:\s+[^;&|<>`$]{1,160})?$/,
  /^(yum|dnf)\s+(list|info|search)\b(?:\s+[^;&|<>`$]{1,160})?$/,
  /^rpm\s+-(qa|qi|ql)(?:\s+[A-Za-z0-9_.:@%+=,~*?-]+)?$/,
  /^dpkg\s+(-l|-s|-L)(?:\s+[A-Za-z0-9_.:@%+=,~*?-]+)?$/,
  /^(npm|pnpm|yarn)\s+(list|ls|view|info|outdated)\b(?:\s+[^;&|<>`$]{1,160})?$/,
  /^(pip|pip3)\s+(list|show|freeze)\b(?:\s+[A-Za-z0-9_.:@%+=,~*?-]+)?$/,
];

const PIPE_FILTER_PATTERNS: RegExp[] = [
  new RegExp(`^grep\\s+(?:-[A-Za-z]{1,6}\\s+)?${SAFE_TEXT}$`),
  /^head(?:\s+-n\s+\d{1,4})?$/,
  /^tail\s+-n\s+\d{1,4}$/,
  /^wc\s+(-l|-c|-m|-w)$/,
  /^sort(?:\s+-[A-Za-z]{1,6})?$/,
  /^uniq(?:\s+-[A-Za-z]{1,6})?$/,
];

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function containsDangerousToken(normalized: string): boolean {
  return DANGEROUS_TOKENS.some(token => {
    if (token === "sudo") {
      return /(^|\s)sudo(\s|$)/.test(normalized);
    }

    return normalized.includes(token);
  });
}

function isReadonlySingleCommand(normalized: string): boolean {
  if (READONLY_PATTERNS.some(pattern => pattern.test(normalized))) {
    return true;
  }

  return isBoundedJournalctlCommand(normalized);
}

function isReadonlyPipeline(normalized: string): boolean {
  const segments = normalized.split("|").map(segment => segment.trim());

  if (
    segments.length < 2 ||
    segments.length > 4 ||
    segments.some(segment => !segment)
  ) {
    return false;
  }

  // 管道第一段必须是有边界的只读查询，后续只允许纯过滤/计数/排序。
  return (
    isReadonlySingleCommand(segments[0]) &&
    segments.slice(1).every(segment =>
      PIPE_FILTER_PATTERNS.some(pattern => pattern.test(segment)),
    )
  );
}

function isBoundedJournalctlCommand(normalized: string): boolean {
  if (!normalized.startsWith("journalctl ")) {
    return false;
  }

  if (/\s(-f|--follow)\b/.test(normalized)) {
    return false;
  }

  const count = normalized.match(/(?:^|\s)-n\s+(\d{1,4})(?:\s|$)/);
  if (!count || Number(count[1]) > 1000) {
    return false;
  }

  return (
    normalized.includes("--no-pager") &&
    /^journalctl\s+[-A-Za-z0-9_./:@%+=,'"~\s]+$/.test(normalized)
  );
}

export function isAutoAllowedQueryCommand(command: string): boolean {
  const normalized = normalizeCommand(command);

  if (!normalized || containsDangerousToken(normalized)) {
    return false;
  }

  if (normalized.includes("|")) {
    return isReadonlyPipeline(normalized);
  }

  return isReadonlySingleCommand(normalized);
}

export function isReadonlyAllowedCommand(command: string): boolean {
  return isAutoAllowedQueryCommand(command);
}

export function requiresMandatoryApproval(
  command: string,
  risk: "low" | "medium" | "high" = "medium",
): boolean {
  const normalized = normalizeCommand(command);
  const firstWord = normalized.split(" ")[0]?.toLowerCase() ?? "";

  return (
    risk === "high" ||
    MUST_APPROVE_PREFIXES.includes(firstWord) ||
    containsDangerousToken(normalized) ||
    MUST_APPROVE_PACKAGE_PATTERNS.some(pattern => pattern.test(normalized)) ||
    MUST_APPROVE_DOCKER_PATTERNS.some(pattern => pattern.test(normalized)) ||
    MUST_APPROVE_SERVICE_PATTERNS.some(pattern => pattern.test(normalized))
  );
}

export function evaluateAiCommand(command: string): AiCommandPolicyResult {
  const normalized = normalizeCommand(command);

  if (!normalized) {
    return { decision: "deny", reason: "命令为空" };
  }

  const firstWord = normalized.split(" ")[0]?.toLowerCase() ?? "";

  if (DENIED_PREFIXES.includes(firstWord)) {
    return {
      decision: "requires_approval",
      reason: "检测到高危命令前缀，必须确认",
    };
  }

  if (containsDangerousToken(normalized)) {
    return {
      decision: "requires_approval",
      reason: "命令包含 Shell 控制符或高权限语法，需要确认",
    };
  }

  if (
    MUST_APPROVE_PACKAGE_PATTERNS.some(pattern => pattern.test(normalized)) ||
    MUST_APPROVE_DOCKER_PATTERNS.some(pattern => pattern.test(normalized)) ||
    MUST_APPROVE_SERVICE_PATTERNS.some(pattern => pattern.test(normalized))
  ) {
    return {
      decision: "requires_approval",
      reason: "检测到可能变更系统、服务或容器状态的命令，需要确认",
    };
  }

  if (isAutoAllowedQueryCommand(normalized)) {
    return { decision: "allow_readonly", reason: "命中只读或有界查询允许规则" };
  }

  return {
    decision: "requires_approval",
    reason: "命令不在只读允许列表中，需要确认",
  };
}
