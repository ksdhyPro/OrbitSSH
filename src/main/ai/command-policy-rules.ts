/** 命令策略使用的高风险命令表与匹配规则。 */

export const DANGEROUS_TOKENS = ["sudo", ">", "<", "&&", "||", ";", "`", "$(", "&"];

export const CRITICAL_APPROVAL_PREFIXES = [
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
export const DESTRUCTIVE_COMMANDS = new Set([
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
export const COMMAND_WRAPPERS = new Set([
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
export const SHELL_KEYWORDS = new Set([
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

export const MUST_APPROVE_PACKAGE_PATTERNS = [
  /^(apt|apt-get|aptitude|yum|dnf|zypper|brew|apk|snap|port)\s+(remove|erase|purge|upgrade|dist-upgrade|full-upgrade|autoremove|clean|del|uninstall)\b/,
  /^pacman\s+-[A-Za-z]*[RU]/,
  /^dpkg\s+(-r|-P|--remove|--purge)\b/,
  /^rpm\s+(-e|--erase)\b/,
  /^(npm|pnpm|yarn)\s+(remove|uninstall|upgrade|publish|unpublish|unlink|rm|un)\b/,
  /^(pip|pip3|pipx|gem|cargo|composer|conda)\s+(uninstall|remove)\b/,
];

export const MUST_APPROVE_DOCKER_PATTERNS = [
  /^(docker|podman|nerdctl)\s+(build|commit|cp|create|exec|kill|login|logout|pause|pull|push|rename|restart|rm|rmi|run|save|start|stop|tag|unpause|update)\b/,
  /^(docker|podman|nerdctl)\s+compose\s+(build|create|down|exec|kill|pause|pull|push|restart|rm|run|start|stop|up|unpause)\b/,
  /^(docker-compose|podman-compose)\s+(build|create|down|exec|kill|pause|pull|push|restart|rm|run|start|stop|up|unpause)\b/,
  /^(docker|podman|nerdctl)\s+(system|builder|container|image|network|volume)\s+(prune|rm|create|disconnect|connect)\b/,
  /^(crictl|ctr)\b(?!\s+(ps|pods|images|img|inspect|inspecti|inspectp|logs|info|version|stats)\b)/,
];

export const MUST_APPROVE_SERVICE_PATTERNS = [
  /^(systemctl|service)\s+\S+\s+(stop|disable|mask)\b/,
  /^systemctl\s+(stop|disable|mask|enable|kill|isolate|poweroff|reboot|halt|suspend|hibernate|edit|set-property|link|preset|revert|daemon-reexec|switch-root|emergency|rescue)\b/,
];

// 删除、覆盖、集群与云资源变更、网络和防火墙调整等在自主执行模式下必须审批。
export const MUST_APPROVE_DESTRUCTIVE_PATTERNS = [
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

export const FIREWALL_COMMAND_PATTERN =
  /^(iptables|ip6tables|iptables-legacy|ip6tables-legacy|iptables-nft|ip6tables-nft|iptables-restore|ip6tables-restore|nft|ufw|firewall-cmd|ebtables|ipset)\b/;

/** 防火墙只放行明确的查询，其余变更可能切断当前 SSH 连接。 */
export function isReadonlyFirewallCommand(normalized: string): boolean {
  if (/^ip6?tables(?:-legacy|-nft)?\b/.test(normalized)) {
    return (
      /\s(-[A-Za-z]*[LS][A-Za-z]*|--list|--list-rules)(\s|$)/.test(normalized) &&
      !/\s(-[AIDRFXPNEZ]|--(append|insert|delete|replace|flush|delete-chain|policy|new-chain|rename-chain|zero))\b/.test(
        normalized,
      )
    );
  }
  return /^(nft\s+list\b|ufw\s+status\b|firewall-cmd\s+(--state|--list-\S+|--get-\S+|--query-\S+)\b|ipset\s+(list|-L)\b)/.test(
    normalized,
  );
}

export const MUST_APPROVE_GENERAL_PATTERNS = [
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
export const INDIRECT_EXECUTION_COMMANDS = new Set([
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

export const REMOTE_SHELL_COMMAND_PATTERN =
  /(?:^|[\s'"`;|&()])(?:[^\s'"`;|&()]+\/)?(?:ssh|scp|sftp)(?=\s|$)/i;

export const INDIRECT_EXECUTION_PATTERN =
  /(?:^|[\s'"`;|&()])(?:[^\s'"`;|&()]+\/)?(?:bash|busybox|dash|eval|fish|ksh|node|perl|php|powershell|pwsh|python3?|ruby|setsid|sh|source|timeout|xargs|zsh)(?=\s|$)/i;
