import type { AiCommandPolicyResult } from "../../shared/ai.js";

const DANGEROUS_TOKENS = [
  "sudo",
  ">",
  "<",
  "|",
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
  /^free\s+-h$/,
  /^vm_stat$/,
  /^top\s+-bn1$/,
  /^ps\s+(aux|-ef)$/,
  /^ip\s+(addr|route)$/,
  /^ifconfig$/,
  /^ss\s+-(tulpn|lntp)$/,
  /^netstat\s+-lntp$/,
  /^ping\s+-c\s+4\s+[A-Za-z0-9_.:-]+$/,
  /^curl\s+-I\s+https?:\/\/\S+$/,
  /^nslookup\s+[A-Za-z0-9_.:-]+$/,
  /^dig\s+[A-Za-z0-9_.:-]+$/,
  /^ls(?:\s+-la)?(?:\s+[A-Za-z0-9_./:@%+=,-]+)?$/,
  /^stat\s+[A-Za-z0-9_./:@%+=,-]+$/,
  /^file\s+[A-Za-z0-9_./:@%+=,-]+$/,
  /^wc\s+-l\s+[A-Za-z0-9_./:@%+=,-]+$/,
  /^head(?:\s+-n\s+\d{1,4})?\s+[A-Za-z0-9_./:@%+=,-]+$/,
  /^tail\s+-n\s+\d{1,4}\s+[A-Za-z0-9_./:@%+=,-]+$/,
  /^cat\s+[A-Za-z0-9_./:@%+=,-]+$/,
  /^grep\s+['"]?[^;&|<>`$]{1,80}['"]?\s+[A-Za-z0-9_./:@%+=,-]+$/,
  /^systemctl\s+status\s+[A-Za-z0-9_.@-]+$/,
  /^systemctl\s+is-active\s+[A-Za-z0-9_.@-]+$/,
  /^journalctl\s+-u\s+[A-Za-z0-9_.@-]+\s+-n\s+\d{1,4}\s+--no-pager$/,
  /^service\s+[A-Za-z0-9_.@-]+\s+status$/,
  /^docker\s+ps(?:\s+-a)?$/,
  /^docker\s+images$/,
  /^docker\s+logs\s+--tail\s+\d{1,4}\s+[A-Za-z0-9_.-]+$/,
  /^docker\s+inspect\s+[A-Za-z0-9_.-]+$/,
  /^docker\s+stats\s+--no-stream$/,
  /^docker\s+compose\s+ps$/,
  /^docker\s+compose\s+logs\s+--tail\s+\d{1,4}$/,
  /^git\s+status$/,
  /^git\s+log\s+--oneline\s+-n\s+\d{1,3}$/,
  /^git\s+branch$/,
  /^git\s+remote\s+-v$/,
  /^git\s+diff(?:\s+--stat)?$/,
];

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function evaluateAiCommand(command: string): AiCommandPolicyResult {
  const normalized = normalizeCommand(command);

  if (!normalized) {
    return { decision: "deny", reason: "Empty command" };
  }

  const firstWord = normalized.split(" ")[0]?.toLowerCase() ?? "";

  if (DENIED_PREFIXES.includes(firstWord)) {
    return {
      decision: "deny",
      reason: "Destructive command prefix is denied",
    };
  }

  if (DANGEROUS_TOKENS.some(token => normalized.includes(token))) {
    return {
      decision: "requires_approval",
      reason: "Command contains shell control or elevated-access syntax",
    };
  }

  if (READONLY_PATTERNS.some(pattern => pattern.test(normalized))) {
    return { decision: "allow_readonly", reason: "Matches readonly allowlist" };
  }

  return {
    decision: "requires_approval",
    reason: "Command is not in the readonly allowlist",
  };
}
