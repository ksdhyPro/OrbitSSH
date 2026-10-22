export const ORBITSSH_MCP_PROTOCOL_VERSION = 2;
export const ORBITSSH_MCP_DESCRIPTOR_FILE = "orbitssh-mcp-endpoint.json";

export interface OrbitSshMcpInstallInfo {
  name: "orbitssh";
  transport: "stdio";
  command: string;
  args: string[];
  skillDirectory: string;
}

export type OrbitSshMcpMethod =
  | "get_status"
  | "list_connections"
  | "execute_command"
  | "upload_file"
  | "download_file"
  | "get_transfer_status";

export interface OrbitSshMcpEndpointDescriptor {
  version: typeof ORBITSSH_MCP_PROTOCOL_VERSION;
  endpoint: string;
  token: string;
  pid: number;
}

export interface OrbitSshMcpRequest {
  requestId: string;
  token: string;
  method: OrbitSshMcpMethod;
  params?: Record<string, unknown>;
}

export interface OrbitSshMcpResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface OrbitSshMcpConnectionSummary {
  id: string;
  name: string;
}

export interface OrbitSshMcpCommandResult {
  connectionId: string;
  connectionName: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export type OrbitSshMcpTransferDirection = "upload" | "download";
export type OrbitSshMcpTransferStatus = "queued" | "transferring" | "completed" | "failed";

export interface OrbitSshMcpTransferResult {
  id: string;
  direction: OrbitSshMcpTransferDirection;
  status: OrbitSshMcpTransferStatus;
  connectionId: string;
  connectionName: string;
  localPath: string;
  remotePath: string;
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
