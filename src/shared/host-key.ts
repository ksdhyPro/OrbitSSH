/** 首次连接（unknown）或主机密钥与已信任记录不一致（changed）时需要用户确认。 */
export type HostKeyPromptKind = "unknown" | "changed";

export interface HostKeyPrompt {
  requestId: string;
  kind: HostKeyPromptKind;
  host: string;
  port: number;
  serverName: string;
  keyType: string;
  fingerprint: string;
  previousKeyType?: string;
  previousFingerprint?: string;
}

export interface HostKeyPromptResponse {
  requestId: string;
  trust: boolean;
}
