import type { AiCommandPolicyResult } from "../../shared/ai.js";
import { evaluateAiCommandDataExposure } from "./ai-data-policy.js";

export interface ShellCommandSegment {
  command: string;
  separatorBefore: ";" | "&&" | "||" | "|" | null;
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

const CRITICAL_APPROVAL_PREFIXES = [
  "rm",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "poweroff",
  "halt",
  "rmdir",
  "truncate",
  "unlink",
  "useradd",
  "userdel",
  "usermod",
  "passwd",
  "chmod",
  "chown",
];

// 磁盘、文件系统、用户组、内核模块等不可逆或影响整机的命令，按命令名直接要求审批。
const DESTRUCTIVE_COMMANDS = new Set([
  "shred",
  "wipefs",
  "fdisk",
  "sfdisk",
  "gdisk",
  "sgdisk",
  "parted",
  "mkswap",
  "swapoff",
  "swapon",
  "blkdiscard",
  "mke2fs",
  "e2fsck",
  "xfs_repair",
  "tune2fs",
  "resize2fs",
  "lvremove",
  "vgremove",
  "pvremove",
  "lvreduce",
  "cryptsetup",
  "mount",
  "umount",
  "chattr",
  "setfacl",
  "chgrp",
  "groupadd",
  "groupdel",
  "groupmod",
  "gpasswd",
  "chpasswd",
  "chage",
  "visudo",
  "vipw",
  "dropdb",
  "dropuser",
  "insmod",
  "rmmod",
  "modprobe",
  "kexec",
  "init",
  "telinit",
  "update-rc.d",
  "chkconfig",
  "netplan",
  "ifdown",
  "ifup",
]);

// 这些命令会以不同方式执行其后的命令，本地无法可靠判断真实意图，一律审批。
const COMMAND_WRAPPERS = new Set([
  "time",
  "stdbuf",
  "ionice",
  "watch",
  "chroot",
  "flock",
  "taskset",
  "strace",
  "ltrace",
  "unbuffer",
  "script",
  "runuser",
  "sg",
  "chrt",
  "numactl",
  "cgexec",
  "firejail",
  "proxychains",
  "proxychains4",
  "nsenter",
  "unshare",
  "systemd-run",
  "parallel",
  "sudoedit",
  "pkexec",
]);

// Shell 控制结构的关键字出现在命令开头时，执行流程无法逐段审查。
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "function",
  "select",
  "coproc",
]);

const MUST_APPROVE_PACKAGE_PATTERNS = [
  /^(apt|apt-get|aptitude|yum|dnf|zypper|brew|apk|snap|port)\s+(remove|erase|purge|upgrade|dist-upgrade|full-upgrade|autoremove|clean|del|uninstall)\b/,
  /^pacman\s+-[A-Za-z]*[RU]/,
  /^dpkg\s+(-r|-P|--remove|--purge)\b/,
  /^rpm\s+(-e|--erase)\b/,
  /^(npm|pnpm|yarn)\s+(remove|uninstall|upgrade|publish|unpublish|unlink|rm|un)\b/,
  /^(pip|pip3|pipx|gem|cargo|composer|conda)\s+(uninstall|remove)\b/,
];

const MUST_APPROVE_DOCKER_PATTERNS = [
  /^(docker|podman|nerdctl)\s+(build|commit|cp|create|exec|kill|login|logout|pause|pull|push|rename|restart|rm|rmi|run|save|start|stop|tag|unpause|update)\b/,
  /^(docker|podman|nerdctl)\s+compose\s+(build|create|down|exec|kill|pause|pull|push|restart|rm|run|start|stop|up|unpause)\b/,
  /^(docker-compose|podman-compose)\s+(build|create|down|exec|kill|pause|pull|push|restart|rm|run|start|stop|up|unpause)\b/,
  /^(docker|podman|nerdctl)\s+(system|builder|container|image|network|volume)\s+(prune|rm|create|disconnect|connect)\b/,
  /^(crictl|ctr)\b(?!\s+(ps|pods|images|img|inspect|inspecti|inspectp|logs|info|version|stats)\b)/,
];

const MUST_APPROVE_SERVICE_PATTERNS = [
  /^(systemctl|service)\s+\S+\s+(stop|disable|mask)\b/,
  /^systemctl\s+(stop|disable|mask|enable|kill|isolate|poweroff|reboot|halt|suspend|hibernate|edit|set-property|link|preset|revert|daemon-reexec|switch-root|emergency|rescue)\b/,
];

// 删除、覆盖、集群与云资源变更、网络和防火墙调整等在自主执行模式下必须审批。
const MUST_APPROVE_DESTRUCTIVE_PATTERNS = [
  /^rsync\b.*\s--(?:del\b|delete\S*|remove-source-files)/,
  /^(terraform|tofu)\s+(apply|destroy|import|taint|untaint|state\s+(rm|mv|push|replace-provider))\b/,
  /^pulumi\s+(up|destroy|refresh|import|stack\s+rm)\b/,
  /^helm\s+(install|upgrade|uninstall|delete|rollback)\b/,
  /^kubectl\s+(drain|cordon|uncordon|taint|annotate|label|set|create|run|expose|cp|debug|attach|autoscale)\b/,
  /^(aws|gcloud|gsutil|az|aliyun|tccli|doctl|oci)\b.*\b(delete|remove|rm|rb|mv|terminate|destroy|purge|deregister|detach|stop|reboot)\b/,
  /^journalctl\b.*\s--(vacuum-[\w-]+|rotate|flush)\b/,
  /^logrotate\b.*\s(-f|--force)\b/,
  /^git\s+(restore|rebase|rm|filter-branch|filter-repo|update-ref)\b/,
  /^git\s+checkout\b.*\s(-f|--force|--|\.)(\s|$)/,
  /^git\s+stash\s+(drop|clear)\b/,
  /^git\s+branch\b.*\s(-[A-Za-z]*[dD]|--delete)\b/,
  /^git\s+(reflog\s+expire|gc\s+--prune)/,
  /^ip\s+(-\d\s+)?(link|addr|address|route|rule|neigh|neighbour|tunnel)\s+(set|del|delete|add|replace|flush|change)\b/,
  /^ifconfig\s+\S+\s+(down|up|del)\b/,
  /^nmcli\b.*\b(down|delete|modify|disconnect|off|reload)\b/,
  /^route\s+(add|del)\b/,
  /^sysctl\b.*(\s(-w|--write|-p|--load|--system)\b|\s[\w./-]+=)/,
  /^(mongo|mongosh)\b.*\s--eval\b/,
  /^history\s+-[cdw]\b/,
  /^unset\s+HISTFILE\b/,
];

const FIREWALL_COMMAND_PATTERN =
  /^(iptables|ip6tables|iptables-legacy|ip6tables-legacy|iptables-nft|ip6tables-nft|iptables-restore|ip6tables-restore|nft|ufw|firewall-cmd|ebtables|ipset)\b/;

/** 防火墙只放行明确的查询，其余变更可能切断当前 SSH 连接。 */
function isReadonlyFirewallCommand(normalized: string): boolean {
  if (/^ip6?tables(?:-legacy|-nft)?\b/.test(normalized)) {
    return (
      /\s(-[A-Za-z]*[LS][A-Za-z]*|--list|--list-rules)(\s|$)/.test(normalized) &&
      !/\s(-[AIDRFXPNEZ]|--(append|insert|delete|replace|flush|delete-chain|policy|new-chain|rename-chain|zero))\b/.test(normalized)
    );
  }
  return /^(nft\s+list\b|ufw\s+status\b|firewall-cmd\s+(--state|--list-\S+|--get-\S+|--query-\S+)\b|ipset\s+(list|-L)\b)/.test(
    normalized,
  );
}

// 写入这些位置可能篡改系统配置、植入持久化或登录凭据，即使是常规写入也必须审批。
const SENSITIVE_WRITE_PATH_PATTERNS = [
  /^\/+$/,
  /^\/(etc|boot|usr|bin|sbin|lib|lib32|lib64|sys|proc)(\/|$)/,
  /^\/var\/(spool\/cron|lib)(\/|$)/,
  /^\/dev\/(?!(null|stdout|stderr|tty)$)/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.(bashrc|bash_profile|bash_login|bash_logout|profile|zshrc|zprofile|zlogin|zshenv|kshrc|cshrc|tcshrc)$/,
  /(^|\/)\.config\/(autostart|systemd)(\/|$)/,
];

function isSensitiveWritePath(path: string): boolean {
  const normalized = path.trim();
  return Boolean(normalized) && SENSITIVE_WRITE_PATH_PATTERNS.some(pattern => pattern.test(normalized));
}

const MUST_APPROVE_GENERAL_PATTERNS = [
  /(^|\s)(sudo|su|doas)(\s|$)/,
  /\|\s*(sh|bash|zsh|fish)\b/,
  /(^|\s)(curl|wget)\b[^|;&]*\|\s*(sh|bash|zsh|fish)\b/,
  /\bof=/,
  /(^|\s)(crontab|at)\b/,
  /(^|\s)(kill|pkill|killall)\b/,
  /(^|\s)find\b.*\s-delete\b/,
  /(^|\s)find\b.*\s-exec\b/,
  /(^|\s)xargs\b.*\s(rm|mv|cp|chmod|chown|kill)\b/,
  /(^|\s)kubectl\s+(apply|delete|edit|exec|scale|rollout|patch|replace)\b/,
  /(^|\s)git\s+(reset|clean|push)\b/,
  /^(curl|wget)\b.*(?:\s-X\s*(POST|PUT|PATCH|DELETE)|\s--request\s+(POST|PUT|PATCH|DELETE)|\s(?:-d|--data|--data-raw|--data-binary|-F|--form|-T|--upload-file)\b)/i,
  /^(redis-cli)\b.*\b(FLUSHALL|FLUSHDB|DEL|UNLINK|SHUTDOWN|CONFIG\s+SET|SCRIPT\s+FLUSH)\b/i,
  /^(mysql|mariadb|psql|sqlite3)\b.*\s(?:-e|-c|--execute)(?:\s|=)/i,
];

// Shell、解释器和批处理包装器可以隐藏真实执行意图，无法仅凭外层命令安全判断。
const INDIRECT_EXECUTION_COMMANDS = new Set([
  ".",
  "bash",
  "dash",
  "eval",
  "fish",
  "ksh",
  "node",
  "perl",
  "python",
  "python3",
  "ruby",
  "sh",
  "source",
  "xargs",
  "zsh",
]);

const REMOTE_SHELL_COMMAND_PATTERN =
  /(?:^|[\s'"`;|&()])(?:[^\s'"`;|&()]+\/)?(?:ssh|scp|sftp)(?=\s|$)/i;

const INDIRECT_EXECUTION_PATTERN =
  /(?:^|[\s'"`;|&()])(?:[^\s'"`;|&()]+\/)?(?:bash|busybox|dash|eval|fish|ksh|node|perl|php|powershell|pwsh|python3?|ruby|setsid|sh|source|timeout|xargs|zsh)(?=\s|$)/i;

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
    if (token === "!") {
      index += 1;
      continue;
    }
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

    if (char === "|" && next === "|") {
      pushCurrent();
      separatorBefore = "||";
      index += 1;
      continue;
    }

    // >| 是强制覆盖重定向，不属于管道。
    if (char === "|" && !current.endsWith(">")) {
      pushCurrent();
      separatorBefore = "|";
      if (next === "&") index += 1;
      continue;
    }

    current += char;
  }

  pushCurrent();
  return segments;
}

/**
 * 查找本地策略无法逐段审查的 Shell 结构：命令替换、子 Shell、分组、输入重定向和后台执行。
 * 这些结构可以把任意命令藏在看似安全的外层命令后面，自主执行模式下统一要求审批。
 */
function getUnsupportedShellStructureReason(command: string): string | null {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    const previous = command[index - 1] ?? "";
    const next = command[index + 1] ?? "";

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && (char === "`" || (char === "$" && next === "("))) {
        return "命令包含动态命令替换，必须确认";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "`" || (char === "$" && next === "(")) {
      return "命令包含动态命令替换，必须确认";
    }
    if (char === "(" || char === ")") {
      return "命令包含子 Shell 或分组结构，本地策略无法逐段审查";
    }
    if (
      (char === "{" && /^$|[\s;&|]/.test(previous) && /\s/.test(next)) ||
      (char === "}" && /[\s;]/.test(previous) && /^$|[\s;&|]/.test(next))
    ) {
      return "命令包含命令分组结构，本地策略无法逐段审查";
    }
    if (char === "<") {
      return "命令包含输入重定向或 Here-Doc，本地策略无法审查输入内容";
    }
    if (char === "&") {
      if (next === "&") {
        index += 1;
        continue;
      }
      // 2>&1、>&2、&>file、|& 属于重定向或管道写法。
      if (previous === ">" || previous === "<" || previous === "|" || next === ">") continue;
      return "命令包含后台执行符 &，本地策略无法跟踪其执行结果";
    }
  }

  return null;
}

interface OutputRedirect {
  operator: ">" | ">>" | ">|";
  target: string;
}

/** 解析单段命令中的输出重定向，并返回去掉重定向后的命令文本。 */
function parseOutputRedirects(segment: string): {
  redirects: OutputRedirect[];
  commandText: string;
} {
  const redirects: OutputRedirect[] = [];
  let commandText = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] ?? "";

    if (escaped) {
      escaped = false;
      commandText += char;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      commandText += char;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      commandText += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      commandText += char;
      continue;
    }
    if (char !== ">") {
      commandText += char;
      continue;
    }

    // 去掉紧邻的文件描述符或 &>，它们属于重定向本身。
    commandText = commandText.replace(/(^|\s)(\d+|&)$/, "$1");
    let operator: OutputRedirect["operator"] = ">";
    if (segment[index + 1] === ">") {
      operator = ">>";
      index += 1;
    } else if (segment[index + 1] === "|") {
      operator = ">|";
      index += 1;
    } else if (segment[index + 1] === "&" && /[\d-]/.test(segment[index + 2] ?? "")) {
      // >&2、2>&1 只复制文件描述符，不写入文件。
      index += 2;
      while (/\d/.test(segment[index + 1] ?? "")) index += 1;
      continue;
    } else if (segment[index + 1] === "&") {
      index += 1;
    }

    while (/\s/.test(segment[index + 1] ?? "")) index += 1;
    let target = "";
    let targetQuote: "'" | '"' | null = null;
    while (index + 1 < segment.length) {
      const targetChar = segment[index + 1] ?? "";
      if (!targetQuote && /[\s;&|<>]/.test(targetChar)) break;
      index += 1;
      if (targetQuote) {
        if (targetChar === targetQuote) targetQuote = null;
        else target += targetChar;
        continue;
      }
      if (targetChar === "'" || targetChar === '"') {
        targetQuote = targetChar;
        continue;
      }
      target += targetChar;
    }
    redirects.push({ operator, target });
    commandText += " ";
  }

  return { redirects, commandText: normalizeCommand(commandText) };
}

function isEmptyOutputCommand(commandText: string): boolean {
  return /^(|:|true|false|cat \/dev\/null|echo( -[neE]+)*( ''| "")?|printf( ''| "")?)$/.test(commandText);
}

function getNonOptionArguments(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith("-"));
}

function getOptionValues(args: string[], names: string[]): string[] {
  const values: string[] = [];
  args.forEach((arg, index) => {
    for (const name of names) {
      if (arg === name && args[index + 1]) values.push(args[index + 1]!);
      if (name.startsWith("--") && arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
      if (!name.startsWith("--") && arg.startsWith(name) && arg.length > name.length) {
        values.push(arg.slice(name.length));
      }
    }
  });
  return values;
}

/** 返回命令会写入的目标路径，用于识别对系统配置和持久化位置的写入。 */
function getCommandWriteTargets(commandName: string, args: string[]): string[] {
  switch (commandName) {
    case "tee":
      return getNonOptionArguments(args);
    case "mv":
      // 移动会同时删除源路径，源和目标都需要检查。
      return [
        ...getOptionValues(args, ["-t", "--target-directory"]),
        ...getNonOptionArguments(args),
      ];
    case "cp":
    case "install":
    case "ln":
    case "rsync": {
      const targetDirectories = getOptionValues(args, ["-t", "--target-directory"]);
      const operands = getNonOptionArguments(args);
      return targetDirectories.length > 0 ? targetDirectories : operands.slice(-1);
    }
    case "sed":
      return args.some(arg => /^-[A-Za-z]*i/.test(arg) || arg.startsWith("--in-place"))
        ? getNonOptionArguments(args)
        : [];
    case "curl":
      return getOptionValues(args, ["-o", "--output"]);
    case "wget":
      return getOptionValues(args, ["-O", "--output-document"]);
    case "tar":
      return getOptionValues(args, ["-C", "--directory"]);
    case "unzip":
      return getOptionValues(args, ["-d"]);
    default:
      return [];
  }
}

/**
 * 常规文件写入可以自主执行，但清空文件内容、写入系统配置和持久化位置
 * （/etc、~/.ssh、Shell 启动脚本等）属于删除或提权级别的影响，必须审批。
 */
function getWriteRiskReason(segment: string): string | null {
  const { redirects, commandText } = parseOutputRedirects(segment);

  for (const redirect of redirects) {
    if (isSensitiveWritePath(redirect.target)) {
      return `写入系统配置或持久化敏感路径：${redirect.target}`;
    }
  }

  const overwritesFile = redirects.some(
    redirect =>
      redirect.operator !== ">>" &&
      !/^\/dev\/(null|stdout|stderr|tty)$/.test(redirect.target),
  );
  if (overwritesFile && isEmptyOutputCommand(commandText)) {
    return "命令会清空文件内容，相当于删除数据";
  }

  const effective = getEffectiveCommand(commandText);
  const args = readShellTokens(effective.normalized).slice(1).map(token => token.value);
  if (
    effective.commandName === "cp" &&
    getNonOptionArguments(args)[0] === "/dev/null"
  ) {
    return "命令会清空文件内容，相当于删除数据";
  }

  const sensitiveTarget = getCommandWriteTargets(effective.commandName, args).find(
    isSensitiveWritePath,
  );
  return sensitiveTarget ? `写入系统配置或持久化敏感路径：${sensitiveTarget}` : null;
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

  if (REMOTE_SHELL_COMMAND_PATTERN.test(command)) {
    return "检测到 SSH、SCP 或 SFTP 跨服务器命令";
  }

  // python3 --version 等纯版本查询不会执行脚本，不按解释器间接执行处理。
  if (
    !VERSION_QUERY_PATTERN.test(normalized) &&
    (INDIRECT_EXECUTION_COMMANDS.has(commandName) ||
      INDIRECT_EXECUTION_PATTERN.test(command))
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
    const decisions = compoundSegments.map(segment =>
      evaluateAiCommand(segment.command),
    );
    const denied = decisions.find(item => item.decision === "deny");
    if (denied) return denied;
    const approval = decisions.find(
      item => item.decision === "requires_approval",
    );
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
