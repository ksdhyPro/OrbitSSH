export interface TerminalOpenResult {
  tabId: string
  serverId: string
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
