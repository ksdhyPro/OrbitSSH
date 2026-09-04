export interface AiCommandDataPolicyResult {
  decision: "allow" | "requires_approval" | "deny";
  reason: string;
}

const HIGH_RISK_SENSITIVE_SOURCE_PATTERNS: Array<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    pattern: /(?:^|[\s'"=])(?:~|\$HOME|\$\{HOME\}|\/root|\/home\/[^\s/'"]+)?\/?\.ssh\/(?:id_[A-Za-z0-9_.*?-]+|[*?][^\s'";|&]*)(?:$|[\s'";|&])/i,
    reason: "命令将读取 SSH 私钥文件",
  },
  {
    pattern: /(?:^|[\s'"=])\/etc\/ssh\/ssh_host_[A-Za-z0-9_.-]+_key(?:$|[\s'";|&])/i,
    reason: "命令将读取 SSH 主机私钥",
  },
  {
    pattern: /(?:^|[\s'"=])(?:~|\$HOME|\$\{HOME\}|\/root|\/home\/[^\s/'"]+)?\/?\.aws\/(?:credentials|cred[*?][^\s'";|&]*)(?:$|[\s'";|&])/i,
    reason: "命令将读取云平台凭据文件",
  },
  {
    pattern: /(?:application_default_credentials\.json|\.docker\/config\.json|\.git-credentials|\.config\/gh\/hosts\.yml|(?:^|[\/\s'"=])\.netrc(?:$|[\s'";|&]))/i,
    reason: "命令将读取认证凭据文件",
  },
  {
    pattern: /(?:\/run\/secrets\/|\/var\/run\/secrets\/|\.gnupg\/private-keys-v1\.d\/)/i,
    reason: "命令将读取运行时挂载的密钥文件",
  },
  {
    pattern: /(?:^|[\s'"=])\/etc\/(?:shadow|gshadow|g?shad[*?][^\s'";|&]*)(?:$|[\s'";|&])/i,
    reason: "命令将读取系统密码摘要文件",
  },
  {
    pattern: /(?:^|[\s'"=])\/etc\/ssl\/private\//i,
    reason: "命令将读取系统私钥目录",
  },
  {
    pattern: /(?:^|[\s'"=])\/proc\/(?:self|\d+)\/environ(?:$|[\s'";|&])/i,
    reason: "命令将读取进程环境变量文件",
  },
  {
    pattern: /(?:169\.254\.169\.254|metadata\.google\.internal)/i,
    reason: "命令将访问云实例元数据凭据地址",
  },
];

const SENSITIVE_READ_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(?:^|[\s'"=\/])\.env(?:\.[A-Za-z0-9_.-]+|[*?][^\s'";|&]*)?(?:$|[\s'";|&])/i,
    reason: "命令可能读取环境配置中的敏感信息",
  },
  {
    pattern: /(?:^|[\s'"=\/])\.(?:npmrc|pypirc)(?:$|[\s'";|&])/i,
    reason: "命令可能读取包管理器凭据",
  },
  {
    pattern: /(?:^|[\s'"=])(?:~|\$HOME|\$\{HOME\}|\/root|\/home\/[^\s/'"]+)?\/?\.kube\/config(?:$|[\s'";|&])/i,
    reason: "命令可能读取集群访问配置",
  },
  {
    pattern: /(?:^|\s)kubectl\s+(?:get|describe)\s+(?:secrets?|secret\/)[^;&|]*/i,
    reason: "命令可能读取 Kubernetes Secret",
  },
  {
    pattern: /(?:^|[\s'"=])(?:~|\$HOME|\$\{HOME\}|\/root|\/home\/[^\s/'"]+)?\/?\.ssh\/(?:config|known_hosts|authorized_keys)(?:$|[\s'";|&])/i,
    reason: "命令可能读取 SSH 连接元数据",
  },
  {
    pattern: /(?:^|[\s'"=])(?:~|\$HOME|\$\{HOME\}|\/root|\/home\/[^\s/'"]+)?\/?\.(?:bash_history|zsh_history|mysql_history|psql_history)(?:$|[\s'";|&])/i,
    reason: "命令可能读取包含敏感参数的历史记录",
  },
  {
    pattern: /(?:^|[\s'"=])\/proc\/(?:self|\d+)\/cmdline(?:$|[\s'";|&])/i,
    reason: "命令可能读取进程完整启动参数",
  },
  {
    pattern: /(^|[;&|]\s*|\s)(?:env|printenv)(?:\s|$)/i,
    reason: "命令会读取进程环境变量",
  },
  {
    pattern: /^\s*(?:docker\s+inspect|git\s+remote\s+-v|ps\s+(?:aux|-ef))\b/i,
    reason: "命令输出可能包含认证信息或敏感参数",
  },
  {
    pattern: /^\s*(?:cat|head|tail|grep|sed|awk)\b[^\r\n]*(?:^|\/)(?:tokens?|secrets?|credentials?|passwords?)(?:[.\s_*?/-]|$)/i,
    reason: "命令可能读取按敏感名称保存的认证信息",
  },
  {
    pattern: /^\s*(?:cat|head|tail|grep|sed|awk)\b[^\r\n]*\/etc\/[^\s'";|&]*[*?]/i,
    reason: "命令将使用通配符批量读取系统配置目录",
  },
  {
    pattern: /^\s*(?:curl|wget)\b[^\r\n]*\$(?:\{)?[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Za-z0-9_]*(?:\})?/i,
    reason: "网络请求参数可能携带环境变量中的凭据",
  },
  {
    pattern: /(?:^|[\s'"=])\/dev\/(?:zero|random|urandom)(?:$|[\s'";|&])/i,
    reason: "命令可能持续读取无界设备数据",
  },
];

/**
 * 单独判断命令可能暴露的数据，避免把“无写入副作用”误认为“可安全外发”。
 * 敏感数据源在逐命令审批和自主执行模式下必须确认；完全访问模式由用户显式承担风险。
 */
export function evaluateAiCommandDataExposure(
  command: string,
): AiCommandDataPolicyResult {
  for (const item of HIGH_RISK_SENSITIVE_SOURCE_PATTERNS) {
    if (item.pattern.test(command)) {
      return { decision: "requires_approval", reason: item.reason };
    }
  }

  for (const item of SENSITIVE_READ_PATTERNS) {
    if (item.pattern.test(command)) {
      return { decision: "requires_approval", reason: item.reason };
    }
  }

  return { decision: "allow", reason: "未发现明确的敏感数据读取" };
}
