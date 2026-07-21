/**
 * SSH exec 输出不是交互式 PTY 输出，通常只包含 LF。xterm 的光标在收到
 * LF 后不会自动回到第 1 列，因此回写到交互式终端前要统一成 CRLF。
 */
export function normalizeTerminalOutputForXterm(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}
