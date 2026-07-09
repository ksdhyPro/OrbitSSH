import type { AiCommandPolicyResult } from "../../shared/ai.js";

export interface ShellCommandSegment {
  command: string;
  separatorBefore: ";" | "&&" | null;
}

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
  "cp",
  "ln",
  "mkdir",
  "mv",
  "rmdir",
  "touch",
  "truncate",
  "unlink",
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
  /^docker\s+(build|commit|cp|create|exec|kill|login|logout|pause|pull|push|rename|restart|rm|rmi|run|save|start|stop|tag|unpause|update)\b/,
  /^docker\s+compose\s+(build|create|down|exec|kill|pause|pull|push|restart|rm|run|start|stop|up|unpause)\b/,
];

const MUST_APPROVE_SERVICE_PATTERNS = [
  /^(systemctl|service)\s+\S+\s+(stop|restart|reload|disable|enable)\b/,
  /^systemctl\s+(stop|restart|reload|disable|enable)\s+\S+/,
];

const MUST_APPROVE_GENERAL_PATTERNS = [
  /(^|\s)(sudo|su|doas)(\s|$)/,
  /(^|\s)(eval|source)\s+/,
  /(^|\s)(sh|bash|zsh|fish)\s+-c\b/,
  /(^|\s)(python|python3|perl|ruby|node|php)\s+-(c|e)\b/,
  /\$\(/,
  /`/,
  /\|\s*(sh|bash|zsh|fish)\b/,
  /(^|\s)(curl|wget)\b[^|;&]*\|\s*(sh|bash|zsh|fish)\b/,
  /(^|\s)tee(\s|$)/,
  /\bof=/,
  /(^|\s)(crontab|at)\b/,
  /(^|\s)(kill|pkill|killall)\b/,
  /(^|\s)find\b.*\s-delete\b/,
  /(^|\s)find\b.*\s-exec\b/,
  /(^|\s)sed\b.*\s-i\b/,
  /(^|\s)xargs\b.*\s(rm|mv|cp|chmod|chown|kill)\b/,
  /(^|\s)kubectl\s+(apply|delete|edit|exec|scale|rollout|patch|replace)\b/,
  /(^|\s)git\s+(reset|clean|checkout|switch|merge|rebase|pull|push|commit|restore)\b/,
];

const SAFE_ARG = "[A-Za-z0-9_./:@%+=,~*?-]+";
const SAFE_TEXT = "['\"]?[^'\";&|<>`$]{1,160}['\"]?";

const READONLY_PATTERNS: RegExp[] = [
  /^pwd$/,
  /^whoami$/,
  /^id(?:\s+[A-Za-z0-9_.-]+)?$/,
  /^which\s+[A-Za-z0-9_.@-]+$/,
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
  /^docker\s+--version$/,
  /^docker\s+version$/,
  /^docker\s+info$/,
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
  /^head\s+-\d{1,4}$/,
  /^tail\s+-n\s+\d{1,4}$/,
  /^tail\s+-\d{1,4}$/,
  /^wc\s+(-l|-c|-m|-w)$/,
  /^sort(?:\s+-[A-Za-z]{1,6})?$/,
  /^uniq(?:\s+-[A-Za-z]{1,6})?$/,
];

const ECHO_SEPARATOR_PATTERN = /^echo\s+['"]?[-=_ ./:\[\]()A-Za-z0-9]{1,80}['"]?$/;

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function getFirstWord(normalized: string): string {
  return normalized.split(" ")[0]?.toLowerCase() ?? "";
}

function stripAllowedReadonlyRedirects(normalized: string): string {
  // 只允许把 stderr 合并到 stdout，且必须出现在命令末尾或管道前。
  return normalized.replace(/\s+2>&1(?=\s*(?:\||$))/g, "").trim();
}

function stripAllowedOutputMerges(normalized: string): string {
  // full 模式下允许常见的 stderr/stdout 合并，不把它当作写重定向。
  return normalized
    .replace(/\s+2>&1(?=\s*(?:\||$))/g, "")
    .replace(/\s+1>&2(?=\s*(?:\||$))/g, "")
    .trim();
}

function hasWriteRedirect(normalized: string): boolean {
  const withoutOutputMerge = stripAllowedOutputMerges(normalized);

  return /(^|[^<])>>?[^&]/.test(withoutOutputMerge) || /<<-?/.test(withoutOutputMerge);
}

function hasBackgroundOperator(normalized: string): boolean {
  const withoutOutputMerge = stripAllowedOutputMerges(normalized)
    .replace(/&&/g, "")
    .replace(/\|\|/g, "");

  return withoutOutputMerge.includes("&");
}

export function splitAiShellCommands(command: string): ShellCommandSegment[] {
  const segments: ShellCommandSegment[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let separatorBefore: ShellCommandSegment["separatorBefore"] = null;

  const pushCurrent = (): void => {
    const text = current.trim();
    if (text) {
      segments.push({ command: text, separatorBefore });
      separatorBefore = null;
    }
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    const next = command[index + 1] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ";") {
      pushCurrent();
      separatorBefore = ";";
      continue;
    }

    if (char === "&" && next === "&") {
      pushCurrent();
      separatorBefore = "&&";
      index += 1;
      continue;
    }

    current += char;
  }

  pushCurrent();
  return segments;
}

function getMandatoryApprovalReason(
  command: string,
  risk: "low" | "medium" | "high" = "medium",
): string | null {
  const normalized = normalizeCommand(command);
  const firstWord = getFirstWord(normalized);

  if (!normalized) {
    return "命令为空";
  }

  if (risk === "high") {
    return "AI 标记为高风险命令";
  }

  if (normalized.includes("||")) {
    return "检测到高风险 Shell 条件控制符";
  }

  if (MUST_APPROVE_PREFIXES.includes(firstWord)) {
    return "命中高风险命令前缀";
  }

  if (hasWriteRedirect(normalized)) {
    return "检测到写入重定向或 heredoc";
  }

  if (hasBackgroundOperator(normalized)) {
    return "检测到后台执行或复杂 Shell 控制符";
  }

  if (
    MUST_APPROVE_PACKAGE_PATTERNS.some(pattern => pattern.test(normalized)) ||
    MUST_APPROVE_DOCKER_PATTERNS.some(pattern => pattern.test(normalized)) ||
    MUST_APPROVE_SERVICE_PATTERNS.some(pattern => pattern.test(normalized)) ||
    MUST_APPROVE_GENERAL_PATTERNS.some(pattern => pattern.test(normalized))
  ) {
    return "命中本地高风险命令黑名单";
  }

  return null;
}

function containsDangerousToken(
  normalized: string,
  options: { allowPipe?: boolean } = {},
): boolean {
  return DANGEROUS_TOKENS.some(token => {
    if (options.allowPipe && token === "|") {
      return false;
    }

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
  const segments = normalized
    .split("|")
    .map(segment => stripAllowedReadonlyRedirects(segment.trim()));

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

function isReadonlyEchoSeparator(normalized: string): boolean {
  return ECHO_SEPARATOR_PATTERN.test(normalized);
}

function isReadonlyCommandOrPipeline(normalized: string): boolean {
  const command = stripAllowedReadonlyRedirects(normalized);

  if (!command) {
    return false;
  }

  if (isReadonlyEchoSeparator(command)) {
    return true;
  }

  if (command.includes("|")) {
    if (containsDangerousToken(command, { allowPipe: true })) {
      return false;
    }

    return isReadonlyPipeline(command);
  }

  if (containsDangerousToken(command)) {
    return false;
  }

  return isReadonlySingleCommand(command);
}

function isReadonlyCompoundCommand(normalized: string): boolean {
  if (normalized.includes("||")) {
    return false;
  }

  const segments = normalized.split(/\s*(?:;|&&)\s*/).map(segment => segment.trim());

  if (
    segments.length < 2 ||
    segments.length > 12 ||
    segments.some(segment => !segment)
  ) {
    return false;
  }

  // 分号只允许串联已确认的只读查询或纯分隔输出。
  return segments.every(segment => isReadonlyCommandOrPipeline(segment));
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

  if (!normalized) {
    return false;
  }

  if (normalized.includes(";") || normalized.includes("&&")) {
    return isReadonlyCompoundCommand(normalized);
  }

  return isReadonlyCommandOrPipeline(normalized);
}

export function isReadonlyAllowedCommand(command: string): boolean {
  return isAutoAllowedQueryCommand(command);
}

export function requiresMandatoryApproval(
  command: string,
  risk: "low" | "medium" | "high" = "medium",
): boolean {
  return getMandatoryApprovalReason(command, risk) !== null;
}

export function evaluateAiCommand(command: string): AiCommandPolicyResult {
  const normalized = normalizeCommand(command);

  if (!normalized) {
    return { decision: "deny", reason: "命令为空" };
  }

  const firstWord = getFirstWord(normalized);

  if (DENIED_PREFIXES.includes(firstWord)) {
    return {
      decision: "requires_approval",
      reason: "检测到高危命令前缀，必须确认",
    };
  }

  const mandatoryApprovalReason = getMandatoryApprovalReason(normalized);
  if (mandatoryApprovalReason) {
    return {
      decision: "requires_approval",
      reason: mandatoryApprovalReason,
    };
  }

  return {
    decision: "allow_readonly",
    reason: "未命中本地高风险黑名单",
  };
}
