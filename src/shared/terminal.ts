export const LOCAL_TERMINAL_SERVER_ID = "__local__"

export type TerminalSessionKind = "ssh" | "local"

export interface TerminalOpenResult {
  tabId: string
  serverId: string
  kind: TerminalSessionKind
  cwd?: string
}

export interface TerminalDataEvent {
  tabId: string
  data: string
}

export interface TerminalStatusEvent {
  tabId: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  message?: string
}

export interface TerminalResizeInput {
  tabId: string
  cols: number
  rows: number
}

/** 独立任务终端用的命令输入，完成标记由 Main Process 追加。 */
export interface TerminalAutomationCommandInput {
  tabId: string
  command: string
  commandIndex: number
}
