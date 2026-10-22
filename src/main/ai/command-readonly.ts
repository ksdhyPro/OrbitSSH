/** 只读命令白名单：可在任何自主程度下直接执行的查询命令。 */
import { CRITICAL_APPROVAL_PREFIXES, DANGEROUS_TOKENS } from "./command-policy-rules.js";
import {
  getCommandBasename,
  getCommandValidationError,
  getFirstWord,
  normalizeCommand,
  splitShellFallbackSegments,
} from "./shell-syntax.js";

export const SAFE_ARG = "[A-Za-z0-9_./:@%+=,~*?-]+";

export const SAFE_TEXT = "['\"]?[^'\";&|<>`$]{1,160}['\"]?";

export const SAFE_TOOL_NAME = "[A-Za-z0-9_.@+-]+";

export const VERSION_QUERY_TOOLS = [
  "ansible",
  "ansible-playbook",
  "apache2",
  "aws",
  "az",
  "bash",
  "brew",
  "cargo",
  "clang",
  "clang\\+\\+",
  "cmake",
  "composer",
  "curl",
  "docker",
  "docker-compose",
  "gcc",
  "g\\+\\+",
  "gcloud",
  "git",
  "go",
  "helm",
  "httpd",
  "java",
  "javac",
  "jq",
  "kubectl",
  "make",
  "mvn",
  "mysql",
  "nginx",
  "node",
  "npm",
  "openssl",
  "perl",
  "php",
  "pip",
  "pip3",
  "pm2",
  "pnpm",
  "psql",
  "python",
  "python3",
  "redis-cli",
  "redis-server",
  "ruby",
  "rustc",
  "ssh",
  "supervisorctl",
  "terraform",
  "tsc",
  "wget",
  "yarn",
  "yq",
].join("|");

export const VERSION_QUERY_PATTERN = new RegExp(
  `^(?:${VERSION_QUERY_TOOLS})\\s+(?:--version|-version|-v|-V|version)$`,
);

export const READONLY_PATTERNS: RegExp[] = [
  /^true$/,
  /^false$/,
  /^pwd$/,
  /^whoami$/,
  /^id(?:\s+[A-Za-z0-9_.-]+)?$/,
  /^which\s+[A-Za-z0-9_.@-]+$/,
  new RegExp(`^command\\s+-v\\s+${SAFE_TOOL_NAME}$`),
  new RegExp(`^type\\s+(?:-a\\s+|-P\\s+|--path\\s+)?${SAFE_TOOL_NAME}$`),
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
  new RegExp(
    `^find\\s+${SAFE_ARG}\\s+-maxdepth\\s+[1-5](?:\\s+-type\\s+[fdl])?(?:\\s+-name\\s+${SAFE_TEXT})?$`,
  ),
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
  /^docker\s+ps(?:\s+-a)?(?:\s+-q)?(?:\s+--format\s+['"]?[^;&|<>`$]{1,120}['"]?)?$/,
  /^docker\s+images$/,
  /^docker\s+logs\s+--tail\s+\d{1,4}\s+[A-Za-z0-9_.-]+$/,
  /^docker\s+inspect\s+[A-Za-z0-9_.-]+$/,
  /^docker\s+stats\s+--no-stream$/,
  /^docker\s+compose\s+version$/,
  /^docker\s+compose\s+ps$/,
  /^docker\s+compose\s+logs\s+--tail\s+\d{1,4}(?:\s+[A-Za-z0-9_.-]+)?$/,
  /^kubectl\s+version\s+--client(?:\s+--short)?$/,
  /^kubectl\s+(?:get|describe)\s+[A-Za-z0-9_.@/-]+(?:\s+[A-Za-z0-9_.@/-]+)?(?:\s+-n\s+[A-Za-z0-9_.-]+)?$/,
  /^helm\s+(?:version|list)(?:\s+-A)?$/,
  /^terraform\s+version$/,
  /^ansible\s+--version$/,
  /^ansible-playbook\s+--version$/,
  /^pm2\s+(?:list|status|--version|-v)$/,
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

export const PIPE_FILTER_PATTERNS: RegExp[] = [
  new RegExp(`^grep\\s+(?:-[A-Za-z]{1,6}\\s+)?${SAFE_TEXT}$`),
  /^head(?:\s+-n\s+\d{1,4})?$/,
  /^head\s+-\d{1,4}$/,
  /^tail\s+-n\s+\d{1,4}$/,
  /^tail\s+-\d{1,4}$/,
  /^wc\s+(-l|-c|-m|-w)$/,
  /^sort(?:\s+-[A-Za-z]{1,6})?$/,
  /^uniq(?:\s+-[A-Za-z]{1,6})?$/,
];

export const ECHO_SEPARATOR_PATTERN = new RegExp(`^echo\\s+${SAFE_TEXT}$`);

export function stripAllowedReadonlyRedirects(normalized: string): string {
  // 只允许只读查询丢弃/合并输出，且必须出现在命令边界前。
  return normalized
    .replace(/\s+2>&1(?=\s*(?:[|&;]|$))/g, "")
    .replace(/\s+1>&2(?=\s*(?:[|&;]|$))/g, "")
    .replace(/\s+(?:[12])?>{1,2}\s*\/dev\/null(?=\s*(?:[|&;]|$))/g, "")
    .trim();
}

export function isReadonlyFallbackChain(normalized: string): boolean {
  const segments = splitShellFallbackSegments(normalized);

  if (segments.length < 2 || segments.length > 8 || segments.some(segment => !segment)) {
    return false;
  }

  // 只允许只读查询之间用 || 做兼容性 fallback，例如 dpkg 查不到再试 rpm。
  return segments.every(segment => isReadonlyCommandOrPipeline(segment));
}

export function containsDangerousToken(
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

export function isReadonlySingleCommand(normalized: string): boolean {
  const firstWord = getFirstWord(normalized);
  const commandName = getCommandBasename(firstWord);

  // 只读推断不能覆盖高风险命令，即使它看起来像版本查询也交给审批层处理。
  if (CRITICAL_APPROVAL_PREFIXES.includes(commandName)) {
    return false;
  }

  if (VERSION_QUERY_PATTERN.test(normalized)) {
    return true;
  }

  if (READONLY_PATTERNS.some(pattern => pattern.test(normalized))) {
    return true;
  }

  return isBoundedJournalctlCommand(normalized);
}

export function isReadonlyPipeline(normalized: string): boolean {
  const segments = normalized
    .split("|")
    .map(segment => stripAllowedReadonlyRedirects(segment.trim()));

  if (segments.length < 2 || segments.length > 4 || segments.some(segment => !segment)) {
    return false;
  }

  // 管道第一段必须是有边界的只读查询，后续只允许纯过滤/计数/排序。
  return (
    isReadonlySingleCommand(segments[0]) &&
    segments.slice(1).every(segment => PIPE_FILTER_PATTERNS.some(pattern => pattern.test(segment)))
  );
}

export function isReadonlyEchoSeparator(normalized: string): boolean {
  return ECHO_SEPARATOR_PATTERN.test(normalized);
}

export function isReadonlyCommandOrPipeline(normalized: string): boolean {
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

export function isReadonlyCompoundCommand(normalized: string): boolean {
  const segments = normalized.split(/\s*(?:;|&&)\s*/).map(segment => segment.trim());

  if (segments.length < 2 || segments.length > 12 || segments.some(segment => !segment)) {
    return false;
  }

  // 分号只允许串联已确认的只读查询、只读 fallback 或纯分隔输出。
  return segments.every(
    segment =>
      isReadonlyCommandOrPipeline(segment) ||
      (segment.includes("||") && isReadonlyFallbackChain(segment)),
  );
}

export function isBoundedJournalctlCommand(normalized: string): boolean {
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
  if (getCommandValidationError(command) || /\r|\n/.test(command)) {
    return false;
  }
  const normalized = normalizeCommand(command);

  if (!normalized) {
    return false;
  }

  if (normalized.includes(";") || normalized.includes("&&")) {
    return isReadonlyCompoundCommand(normalized);
  }

  if (normalized.includes("||")) {
    return isReadonlyFallbackChain(normalized);
  }

  return isReadonlyCommandOrPipeline(normalized);
}
