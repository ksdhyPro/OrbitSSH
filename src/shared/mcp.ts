export const ORBITSSH_MCP_PROTOCOL_VERSION = 1
export const ORBITSSH_MCP_DESCRIPTOR_FILE = 'orbitssh-mcp-endpoint.json'

export type OrbitSshMcpMethod = 'get_status' | 'list_connections' | 'execute_command'

export interface OrbitSshMcpEndpointDescriptor {
  version: typeof ORBITSSH_MCP_PROTOCOL_VERSION
  endpoint: string
  token: string
  pid: number
}

export interface OrbitSshMcpRequest {
  requestId: string
  token: string
  method: OrbitSshMcpMethod
  params?: Record<string, unknown>
}

export interface OrbitSshMcpResponse {
  requestId: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

export interface OrbitSshMcpConnectionSummary {
  id: string
  name: string
}

export interface OrbitSshMcpCommandResult {
  connectionId: string
  connectionName: string
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}
