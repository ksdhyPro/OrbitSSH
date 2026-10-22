/** 交互 Shell 的实时路径同步：生成提示符钩子命令，并过滤注入命令在终端上的回显。 */

/** 记录已写入交互 Shell、等待从回显中移除的内部命令。 */
export interface ShellEchoFilterState {
  pendingShellCommandEcho?: string;
  pendingShellCommandEchoPrefix?: string;
  /** 回显正文已移除，但命令提交产生的换行还没到达（"crlf" 等待 \r\n 或 \n，"lf" 只差 \n）。 */
  pendingShellCommandEchoLineBreak?: "crlf" | "lf";
}

/** 移除回显之后紧跟的提交换行；换行可能落在下一包，甚至 \r 与 \n 被拆开。 */
function stripPendingLineBreak(session: ShellEchoFilterState, data: string): string {
  const expected = session.pendingShellCommandEchoLineBreak;
  if (!expected || !data) return data;
  session.pendingShellCommandEchoLineBreak = undefined;
  if (data.startsWith("\n")) return data.slice(1);
  if (expected === "crlf" && data.startsWith("\r\n")) return data.slice(2);
  if (expected === "crlf" && data === "\r") {
    session.pendingShellCommandEchoLineBreak = "lf";
    return "";
  }
  return data;
}

/**
 * 为支持的交互 Shell 注入临时提示符钩子，使用户 cd 后主动发送 OSC 7 路径。
 * 钩子仅存在于当前 SSH Shell，不会修改远端的 Shell 配置文件。
 */
export function getShellPathIntegrationCommand(shellPath: string): string | null {
  const shellName = shellPath.trim().split("/").at(-1)?.toLowerCase();

  switch (shellName) {
    case "bash":
      return '__orbitssh_emit_cwd() { printf \'\\033]7;file://%s\\007\' "$PWD"; }; PROMPT_COMMAND="__orbitssh_emit_cwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}"\r';
    case "zsh":
      return "function __orbitssh_emit_cwd() { printf '\\033]7;file://%s\\007' \"$PWD\"; }; precmd_functions+=(__orbitssh_emit_cwd)\r";
    case "fish":
      return "function __orbitssh_emit_cwd --on-variable PWD; printf '\\033]7;file://%s\\007' \"$PWD\"; end\r";
    default:
      return null;
  }
}

/**
 * 交互 Shell 会原样回显 SSH 客户端写入的字符。路径同步钩子属于内部命令，
 * 不应污染用户终端，因此只移除与本次注入完全匹配的一段回显。
 */
export function stripInjectedShellCommandEcho(session: ShellEchoFilterState, data: string): string {
  data = stripPendingLineBreak(session, data);
  const pendingCommand = session.pendingShellCommandEcho;

  if (!pendingCommand) {
    return data;
  }

  // 发送时以 CR 提交命令，终端回显通常会转换为 CRLF，因此仅匹配命令正文。
  const commandText = pendingCommand.replace(/\r$/, "");
  const bufferedPrefix = session.pendingShellCommandEchoPrefix ?? "";
  const candidate = `${bufferedPrefix}${data}`;
  const echoIndex = candidate.indexOf(commandText);

  if (echoIndex < 0) {
    // SSH 数据可能拆分在命令正文中间；暂存最长可匹配前缀，下一包继续判断。
    const maxPrefixLength = Math.min(commandText.length - 1, candidate.length);

    for (let length = maxPrefixLength; length > 0; length -= 1) {
      const suffix = candidate.slice(-length);

      if (commandText.startsWith(suffix)) {
        session.pendingShellCommandEchoPrefix = suffix;
        return candidate.slice(0, -length);
      }
    }

    session.pendingShellCommandEchoPrefix = undefined;
    return candidate;
  }

  session.pendingShellCommandEcho = undefined;
  session.pendingShellCommandEchoPrefix = undefined;
  const beforeEcho = candidate.slice(0, echoIndex);
  const afterEcho = candidate.slice(echoIndex + commandText.length);

  // 同时移除命令提交产生的换行，避免在首次提示符前留下空白行；换行未到达时留到下一包处理。
  if (!afterEcho) {
    session.pendingShellCommandEchoLineBreak = "crlf";
    return beforeEcho;
  }
  if (afterEcho === "\r") {
    session.pendingShellCommandEchoLineBreak = "lf";
    return beforeEcho;
  }
  return `${beforeEcho}${afterEcho.replace(/^\r?\n/, "")}`;
}
