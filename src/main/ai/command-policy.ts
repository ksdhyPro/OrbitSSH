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

const MAX_AI_COMMAND_CHARS = 4_096;

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
  /^docker\s+(system|builder|container|image|network|volume)\s+(prune|rm|create|disconnect|connect)\b/,
];

const MUST_APPROVE_SERVICE_PATTERNS = [
  /^(systemctl|service)\s+\S+\s+(stop|restart|reload|disable|enable|mask|unmask)\b/,
  /^systemctl\s+(stop|restart|reload|disable|enable|mask|unmask|daemon-reload)\b/,
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
  /^(curl|wget)\b.*(?:\s-X\s*(POST|PUT|PATCH|DELETE)|\s--request\s+(POST|PUT|PATCH|DELETE)|\s(?:-d|--data|--data-raw|--data-binary|-F|--form|-T|--upload-file)\b)/i,
  /^(redis-cli)\b.*\b(FLUSHALL|FLUSHDB|DEL|UNLINK|SHUTDOWN|CONFIG\s+SET|SCRIPT\s+FLUSH)\b/i,
  /^(mysql|mariadb|psql|sqlite3)\b.*\s(?:-e|-c|--execute)(?:\s|=)/i,
  /^(python|python3|perl|ruby|node|php)\s+(?!--version\b|-version\b|-v\b|-V\b|version\b).+/,
  /^(sh|bash|zsh|fish)\s+(?!--version\b|-version\b).+/,
];

const SAFE_ARG = "[A-Za-z0-9_./:@%+=,~*?-]+";
const SAFE_TEXT = "['\"]?[^'\";&|<>`$]{1,160}['\"]?";
const SAFE_TOOL_NAME = "[A-Za-z0-9_.@+-]+";
const VERSION_QUERY_TOOLS = [
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
const VERSION_QUERY_PATTERN = new RegExp(
  `^(?:${VERSION_QUERY_TOOLS})\\s+(?:--version|-version|-v|-V|version)$`,
);

const READONLY_PATTERNS: RegExp[] = [
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

const ECHO_SEPARATOR_PATTERN = new RegExp(`^echo\\s+${SAFE_TEXT}$`);

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function getCommandValidationError(command: string): string | null {
  if (!command.trim()) return "命令为空";
  if (command.length > MAX_AI_COMMAND_CHARS) {
    return `命令长度超过 ${MAX_AI_COMMAND_CHARS} 个字符`;
  }
  if (command.includes("\0")) return "命令包含非法空字符";

  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = quote === char ? null : (quote ?? char);
    }
  }

  if (quote) return "命令包含未闭合引号";
  if (escaped) return "命令以未完成的转义符结尾";
  return null;
}

interface LeadingToken {
  value: string;
  start: number;
  end: number;
}

function readShellTokens(command: string): LeadingToken[] {
  const tokens: LeadingToken[] = [];
  let index = 0;

  while (index < command.length) {
    while (/\s/.test(command[index] ?? "")) index += 1;
    if (index >= command.length) break;

    const start = index;
    let value = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;
    for (; index < command.length; index += 1) {
      const char = command[index] ?? "";
      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }
      if (char === "\\" && quote !== "'") {
        escaped = true;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = quote === char ? null : (quote ?? char);
        continue;
      }
      if (!quote && /\s/.test(char)) break;
      value += char;
    }
    tokens.push({ value, start, end: index });
  }

  return tokens;
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function getEffectiveCommand(normalized: string): {
  commandName: string;
  normalized: string;
} {
  const tokens = readShellTokens(normalized);
  let index = 0;

  while (index < tokens.length && isEnvironmentAssignment(tokens[index]!.value)) {
    index += 1;
  }

  for (let depth = 0; depth < 8 && index < tokens.length; depth += 1) {
    const token = getCommandBasename(tokens[index]!.value.toLowerCase());
    if (token === "env") {
      index += 1;
      while (index < tokens.length) {
        const value = tokens[index]!.value;
        if (isEnvironmentAssignment(value)) {
          index += 1;
          continue;
        }
        if (value === "-u" || value === "--unset") {
          index += 2;
          continue;
        }
        if (value.startsWith("-")) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (token === "command" || token === "builtin" || token === "exec") {
      index += 1;
      while (tokens[index]?.value.startsWith("-")) index += 1;
      continue;
    }
    if (token === "nice") {
      index += 1;
      if (tokens[index]?.value === "-n") index += 2;
      else if (tokens[index]?.value === "--adjustment") index += 2;
      else if (tokens[index]?.value.startsWith("--adjustment=")) index += 1;
      else if (/^-\d+$/.test(tokens[index]?.value ?? "")) index += 1;
      continue;
    }
    if (token === "nohup") {
      index += 1;
      if (tokens[index]?.value === "--") index += 1;
      continue;
    }
    break;
  }

  const effective = tokens[index];
  if (!effective) return { commandName: "", normalized };
  const commandName = getCommandBasename(effective.value.toLowerCase());
  return {
    commandName,
    normalized: `${commandName}${normalized.slice(effective.end)}`,
  };
}

function getFirstWord(normalized: string): string {
  return normalized.split(" ")[0]?.toLowerCase() ?? "";
}

function getCommandBasename(firstWord: string): string {
  // 兼容 /usr/bin/tool 这类绝对路径，只用命令名判断高风险前缀。
  return firstWord.replace(/\\/g, "/").split("/").pop() ?? firstWord;
}

function stripAllowedReadonlyRedirects(normalized: string): string {
  // 只允许只读查询丢弃/合并输出，且必须出现在命令边界前。
  return normalized
    .replace(/\s+2>&1(?=\s*(?:[|&;]|$))/g, "")
    .replace(/\s+1>&2(?=\s*(?:[|&;]|$))/g, "")
    .replace(/\s+(?:[12])?>{1,2}\s*\/dev\/null(?=\s*(?:[|&;]|$))/g, "")
    .trim();
}

function stripAllowedOutputMerges(normalized: string): string {
  // full 模式下允许常见的 stderr/stdout 合并和 /dev/null 丢弃输出。
  return stripAllowedReadonlyRedirects(normalized);
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

function splitShellFallbackSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = (): void => {
    const text = current.trim();
    if (text) {
      segments.push(text);
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

    if (char === "|" && next === "|") {
      pushCurrent();
      index += 1;
      continue;
    }

    current += char;
  }

  pushCurrent();
  return segments;
}

function isReadonlyFallbackChain(normalized: string): boolean {
  const segments = splitShellFallbackSegments(normalized);

  if (
    segments.length < 2 ||
    segments.length > 8 ||
    segments.some(segment => !segment)
  ) {
    return false;
  }

  // 只允许只读查询之间用 || 做兼容性 fallback，例如 dpkg 查不到再试 rpm。
  return segments.every(segment => isReadonlyCommandOrPipeline(segment));
}

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

  if (
    normalized.includes("||") &&
    !isReadonlyFallbackChain(normalized) &&
    !isReadonlyCompoundCommand(normalized)
  ) {
    return "检测到高风险 Shell 条件控制符";
  }

  if (MUST_APPROVE_PREFIXES.includes(commandName)) {
    return "命中高风险命令前缀";
  }

  if (hasWriteRedirect(normalized)) {
    return "检测到写入重定向或 heredoc";
  }

  if (/(^|[^<])<($|[^<])/.test(normalized)) {
    return "检测到输入重定向";
  }

  if (hasBackgroundOperator(normalized)) {
    return "检测到后台执行或复杂 Shell 控制符";
  }

  if (
    MUST_APPROVE_PACKAGE_PATTERNS.some(pattern => pattern.test(effective.normalized)) ||
    MUST_APPROVE_DOCKER_PATTERNS.some(pattern => pattern.test(effective.normalized)) ||
    MUST_APPROVE_SERVICE_PATTERNS.some(pattern => pattern.test(effective.normalized)) ||
    MUST_APPROVE_GENERAL_PATTERNS.some(pattern => pattern.test(effective.normalized))
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
  const firstWord = getFirstWord(normalized);
  const commandName = getCommandBasename(firstWord);

  // 只读推断不能覆盖高风险命令，即使它看起来像版本查询也交给审批层处理。
  if (MUST_APPROVE_PREFIXES.includes(commandName)) {
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
  const segments = normalized.split(/\s*(?:;|&&)\s*/).map(segment => segment.trim());

  if (
    segments.length < 2 ||
    segments.length > 12 ||
    segments.some(segment => !segment)
  ) {
    return false;
  }

  // 分号只允许串联已确认的只读查询、只读 fallback 或纯分隔输出。
  return segments.every(
    segment =>
      isReadonlyCommandOrPipeline(segment) ||
      (segment.includes("||") && isReadonlyFallbackChain(segment)),
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

export function isReadonlyAllowedCommand(command: string): boolean {
  return isAutoAllowedQueryCommand(command);
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

  const compoundSegments = splitAiShellCommands(command);
  if (compoundSegments.length > 1) {
    const decisions = compoundSegments.map(segment =>
      evaluateAiCommand(segment.command),
    );
    const denied = decisions.find(item => item.decision === "deny");
    if (denied) return denied;
    const approval = decisions.find(
      item => item.decision === "requires_approval",
    );
    if (approval) return approval;
    return decisions.every(item => item.decision === "allow_readonly")
      ? { decision: "allow_readonly", reason: "复合命令均命中只读白名单" }
      : {
          decision: "allow_full",
          reason: "复合命令未命中高风险黑名单，仅完全访问模式可自动执行",
        };
  }

  const effective = getEffectiveCommand(normalized);

  if (DENIED_PREFIXES.includes(effective.commandName)) {
    return {
      decision: "requires_approval",
      reason: "检测到高危命令前缀，必须确认",
    };
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
    decision: "allow_full",
    reason: "未命中本地高风险黑名单，仅完全访问模式可自动执行",
  };
}
