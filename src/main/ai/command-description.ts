import type { AiCommandPolicyResult } from "../../shared/ai.js";

export interface AiCommandDescriptionOptions {
  policy: AiCommandPolicyResult;
  modelReason?: string;
}

interface CommandAnalysis {
  actions: string[];
  risks: string[];
}

const chineseTextPattern = /[\u3400-\u9fff]/;

function compactText(value: string, maxLength = 180): string {
  const compacted = value.trim().replace(/\s+/g, " ");
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 1)}…`
    : compacted;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function formatInlineValue(value: string): string {
  return `\`${compactText(stripOuterQuotes(value), 100).replace(/`/g, "'")}\``;
}

function readShellWords(fragment: string): string[] {
  return (fragment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [])
    .map(stripOuterQuotes)
    .filter(Boolean);
}

function readOperands(fragment: string): string[] {
  return readShellWords(fragment).filter(
    word => word !== "--" && !word.startsWith("-"),
  );
}

function formatValues(values: string[], emptyFallback = "指定目标"): string {
  if (values.length === 0) return emptyFallback;
  const visible = values.slice(0, 3).map(formatInlineValue);
  return values.length > visible.length
    ? `${visible.join("、")} 等 ${values.length} 个目标`
    : visible.join("、");
}

function pushUnique(target: string[], value: string): void {
  const text = compactText(value, 260);
  if (text && !target.includes(text)) target.push(text);
}

function analyzeCommand(command: string): CommandAnalysis {
  const actions: string[] = [];
  const risks: string[] = [];
  const normalized = command.replace(/\\\r?\n/g, " ");

  for (const match of normalized.matchAll(/\b(?:command\s+-v|which)\s+([^\s;&|]+)/gi)) {
    pushUnique(actions, `检查 ${formatInlineValue(match[1] ?? "工具")} 是否可用。`);
  }

  for (const match of normalized.matchAll(/\bmkdir\b([^\r\n;&|]*)/gi)) {
    const targets = readOperands(match[1] ?? "");
    pushUnique(actions, `创建目录 ${formatValues(targets)}。`);
    pushUnique(risks, "会在服务器上创建目录并改变文件系统结构");
  }

  for (const match of normalized.matchAll(/(?:^|[^>])(>>?)\s*([^\s;&|]+)/gm)) {
    const operator = match[1] ?? ">";
    const target = stripOuterQuotes(match[2] ?? "");
    if (!target || target.startsWith("&") || target === "/dev/null") continue;
    pushUnique(
      actions,
      operator === ">>"
        ? `向文件 ${formatInlineValue(target)} 追加内容。`
        : `覆盖写入文件 ${formatInlineValue(target)}。`,
    );
    pushUnique(
      risks,
      operator === ">>"
        ? "会修改现有文件内容"
        : "会覆盖目标文件，原内容可能丢失",
    );
  }

  for (const match of normalized.matchAll(/\btee\b(\s+-a)?\s+([^\s;&|]+)/gi)) {
    const target = match[2] ?? "指定文件";
    pushUnique(
      actions,
      match[1]
        ? `向文件 ${formatInlineValue(target)} 追加内容。`
        : `写入文件 ${formatInlineValue(target)}。`,
    );
    pushUnique(risks, "会修改服务器上的文件内容");
  }

  for (const match of normalized.matchAll(/\brm\b([^\r\n;&|]*)/gi)) {
    const targets = readOperands(match[1] ?? "");
    pushUnique(actions, `删除 ${formatValues(targets)}。`);
    pushUnique(risks, "删除操作可能不可恢复，请确认目标路径准确");
  }

  for (const match of normalized.matchAll(/\b(mv|cp)\b([^\r\n;&|]*)/gi)) {
    const operation = (match[1] ?? "").toLowerCase() === "mv" ? "移动或重命名" : "复制";
    const targets = readOperands(match[2] ?? "");
    pushUnique(actions, `${operation} ${formatValues(targets)}。`);
    pushUnique(risks, "可能覆盖同名目标或改变文件位置");
  }

  for (const match of normalized.matchAll(/\b(chmod|chown)\b([^\r\n;&|]*)/gi)) {
    const operation = (match[1] ?? "").toLowerCase() === "chmod" ? "权限" : "所有者";
    const operands = readOperands(match[2] ?? "");
    const value = operands.shift();
    pushUnique(
      actions,
      `将 ${formatValues(operands)} 的${operation}修改为 ${formatInlineValue(value ?? "指定值")}。`,
    );
    pushUnique(risks, "权限或所有者变更可能影响访问控制和服务运行");
  }

  const composePattern = /\b(?:docker(?:-compose|\s+compose))\b(?:\s+(?:-f|--file|--project-name)\s+\S+)*\s+(up|down|restart|start|stop|pull|build|rm|ps|logs)\b/gi;
  for (const match of normalized.matchAll(composePattern)) {
    const operation = (match[1] ?? "").toLowerCase();
    const descriptions: Record<string, string> = {
      up: "启动或更新 Docker Compose 中定义的容器。",
      down: "停止并移除 Docker Compose 管理的容器和网络。",
      restart: "重启 Docker Compose 服务。",
      start: "启动已有的 Docker Compose 服务。",
      stop: "停止 Docker Compose 服务。",
      pull: "拉取 Docker Compose 服务所需的镜像。",
      build: "构建 Docker Compose 服务镜像。",
      rm: "移除 Docker Compose 服务容器。",
      ps: "查询 Docker Compose 容器状态。",
      logs: "读取 Docker Compose 服务日志。",
    };
    pushUnique(actions, descriptions[operation] ?? "操作 Docker Compose 服务。");
    if (!["ps", "logs"].includes(operation)) {
      pushUnique(risks, "容器变更可能造成服务短暂中断并占用网络、端口或存储资源");
    }
  }

  for (const match of normalized.matchAll(/\bdocker\s+(run|start|stop|restart|kill|rm|rmi|pull|build|ps|inspect|logs)\b/gi)) {
    const operation = (match[1] ?? "").toLowerCase();
    const descriptions: Record<string, string> = {
      run: "创建并启动 Docker 容器。",
      start: "启动 Docker 容器。",
      stop: "停止 Docker 容器。",
      restart: "重启 Docker 容器。",
      kill: "强制终止 Docker 容器。",
      rm: "删除 Docker 容器。",
      rmi: "删除 Docker 镜像。",
      pull: "拉取 Docker 镜像。",
      build: "构建 Docker 镜像。",
      ps: "查询 Docker 容器状态。",
      inspect: "读取 Docker 对象的详细信息。",
      logs: "读取 Docker 容器日志。",
    };
    pushUnique(actions, descriptions[operation] ?? "操作 Docker 环境。");
    if (!["ps", "inspect", "logs"].includes(operation)) {
      pushUnique(risks, "Docker 资源变更可能影响正在运行的服务");
    }
  }

  for (const match of normalized.matchAll(/\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|status)\s+([^\s;&|]+)/gi)) {
    const operation = (match[1] ?? "").toLowerCase();
    const service = formatInlineValue(match[2] ?? "服务");
    const descriptions: Record<string, string> = {
      start: `启动系统服务 ${service}。`,
      stop: `停止系统服务 ${service}。`,
      restart: `重启系统服务 ${service}。`,
      reload: `重新加载系统服务 ${service} 的配置。`,
      enable: `设置系统服务 ${service} 开机自动启动。`,
      disable: `取消系统服务 ${service} 开机自动启动。`,
      mask: `屏蔽系统服务 ${service}，阻止其启动。`,
      unmask: `解除系统服务 ${service} 的屏蔽。`,
      status: `查询系统服务 ${service} 的运行状态。`,
    };
    pushUnique(actions, descriptions[operation] ?? `操作系统服务 ${service}。`);
    if (operation !== "status") {
      pushUnique(risks, "服务状态变更可能导致相关业务短暂或持续不可用");
    }
  }

  for (const match of normalized.matchAll(/\bservice\s+([^\s;&|]+)\s+(start|stop|restart|reload|status)\b/gi)) {
    const service = formatInlineValue(match[1] ?? "服务");
    const operation = (match[2] ?? "").toLowerCase();
    pushUnique(
      actions,
      operation === "status"
        ? `查询系统服务 ${service} 的运行状态。`
        : `${operation === "start" ? "启动" : operation === "stop" ? "停止" : operation === "reload" ? "重新加载" : "重启"}系统服务 ${service}。`,
    );
    if (operation !== "status") {
      pushUnique(risks, "服务状态变更可能导致相关业务短暂或持续不可用");
    }
  }

  for (const match of normalized.matchAll(/\b(apt|apt-get|yum|dnf|pacman|zypper|brew|npm|pnpm|yarn|pip|pip3)\s+(install|add|remove|uninstall|purge|upgrade|update)\b([^\r\n;&|]*)/gi)) {
    const manager = match[1] ?? "包管理器";
    const operation = (match[2] ?? "").toLowerCase();
    const packages = readOperands(match[3] ?? "");
    const removing = ["remove", "uninstall", "purge"].includes(operation);
    pushUnique(
      actions,
      `${removing ? "卸载" : operation === "update" || operation === "upgrade" ? "更新" : "安装"}软件包 ${formatValues(packages)}（使用 ${formatInlineValue(manager)}）。`,
    );
    pushUnique(risks, "软件包变更可能修改依赖、配置文件或正在运行的服务");
  }

  if (/\b(?:ufw|iptables|nft|firewall-cmd)\b/i.test(normalized)) {
    pushUnique(actions, "修改服务器防火墙或网络访问规则。");
    pushUnique(risks, "错误的网络规则可能中断 SSH 或业务访问");
  }

  if (/\b(?:useradd|userdel|usermod|passwd|groupadd|groupdel|groupmod)\b/i.test(normalized)) {
    pushUnique(actions, "修改服务器用户、用户组或登录凭据。");
    pushUnique(risks, "账户变更会影响登录权限和系统访问控制");
  }

  if (/\b(?:kill|pkill|killall)\b/i.test(normalized)) {
    pushUnique(actions, "终止一个或多个正在运行的进程。");
    pushUnique(risks, "终止进程可能中断服务或造成未保存数据丢失");
  }

  if (/\b(?:curl|wget)\b[^\r\n|;&]*\|\s*(?:sh|bash|zsh|fish)\b/i.test(normalized)) {
    pushUnique(actions, "下载远程脚本并直接交给 Shell 执行。");
    pushUnique(risks, "远程脚本会直接在服务器上执行，内容与来源必须可信");
  }

  if (actions.length === 0) {
    if (/\b(?:docker(?:-compose|\s+compose))\s+(?:--version|version)\b/i.test(normalized)) {
      pushUnique(actions, "查询 Docker Compose 版本，确认工具是否可用。");
    } else if (/\bdf\s+-h\b/i.test(normalized)) {
      pushUnique(actions, "查询服务器文件系统的磁盘使用情况。");
    } else if (/\b(?:free\s+-h|vm_stat)\b/i.test(normalized)) {
      pushUnique(actions, "查询服务器内存使用情况。");
    } else if (/^\s*pwd\s*$/i.test(normalized)) {
      pushUnique(actions, "查询当前工作目录。");
    } else if (/\b(?:cat|head|tail|grep|less|stat|ls|find)\b/i.test(normalized)) {
      pushUnique(actions, "读取或查询服务器上的文件和目录信息。");
    }
  }

  return { actions, risks };
}

function createPurpose(actions: string[], modelReason?: string): string {
  if (actions.length === 1) return actions[0] ?? "执行该 Shell 命令。";
  if (actions.length > 1) {
    const preview = actions
      .slice(0, 3)
      .map(action => action.replace(/[。；]$/, ""))
      .join("；");
    return `依次执行 ${actions.length} 项服务器操作，主要包括：${preview}${actions.length > 3 ? "等" : ""}。`;
  }
  if (modelReason && chineseTextPattern.test(modelReason)) {
    return `${compactText(modelReason).replace(/[。；]$/, "")}。`;
  }
  return "执行该 Shell 命令以完成当前 AI 请求中的操作。";
}

export function describeAiCommandForApproval(
  command: string,
  options: AiCommandDescriptionOptions,
): string {
  const analysis = analyzeCommand(command);
  const purpose = createPurpose(analysis.actions, options.modelReason);
  const lines = [`用途：${purpose}`];

  if (analysis.actions.length > 1) {
    lines.push("主要操作：", ...analysis.actions.map(action => `- ${action}`));
  }

  if (analysis.risks.length > 0) {
    lines.push(`风险：${analysis.risks.join("；")}。`);
  } else if (options.policy.decision === "allow_readonly") {
    lines.push("风险：本地分析认为该命令主要进行只读查询，不应修改服务器状态。仍请核对查询目标与参数。");
  } else {
    lines.push("风险：该命令可能修改服务器状态，执行前请核对命令内容和影响范围。");
  }

  const modelReason = compactText(options.modelReason ?? "");
  if (modelReason && chineseTextPattern.test(modelReason) && !purpose.includes(modelReason)) {
    lines.push(`AI 说明：${modelReason}`);
  }
  lines.push(`本地策略：${compactText(options.policy.reason)}`);
  return lines.join("\n");
}
