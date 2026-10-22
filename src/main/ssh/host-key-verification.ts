import { createHash, randomUUID } from "node:crypto";

import { Client } from "ssh2";

import type { HostKeyPrompt } from "../../shared/host-key.js";

export interface KnownHostRecord {
  keyType: string;
  fingerprint: string;
  /** SSH 线格式公钥的 Base64，便于日后导出为 known_hosts。 */
  publicKey: string;
  trustedAt: number;
}

export interface KnownHostsRepository {
  get(hostId: string): KnownHostRecord | undefined;
  set(hostId: string, record: KnownHostRecord): void;
}

export type HostKeyDecisionRequester = (prompt: HostKeyPrompt) => Promise<boolean>;

export interface HostKeyTarget {
  host: string;
  port: number;
  serverName: string;
  /** 仅用于满足 ssh2 的参数校验，探测在认证前就会中止，不会发送任何凭据。 */
  username?: string;
}

/** 获取服务器主机公钥；失败或超时返回 null，由正式连接按原有方式报告错误。 */
export type HostKeyProbe = (target: HostKeyTarget) => Promise<Buffer | null>;

export interface ParsedHostKey {
  keyType: string;
  fingerprint: string;
  publicKey: string;
}

/** ssh2 在未设置 hostHash 时把原始主机公钥交给校验函数，异步结果通过 verify 回调返回。 */
export type SshHostVerifier = (key: Buffer, verify: (permitted: boolean) => void) => void;

export const HOST_KEY_REJECTED_MESSAGE =
  "主机密钥未被信任，连接已中止。如确认服务器密钥无误，请在弹窗中选择信任后重新连接。";

/** 与 OpenSSH known_hosts 一致：非默认端口使用 [host]:port 形式，主机名不区分大小写。 */
export function getHostKeyId(host: string, port: number): string {
  const normalizedHost = host.trim().toLowerCase();
  return port === 22 ? normalizedHost : `[${normalizedHost}]:${port}`;
}

/** 解析 SSH 线格式公钥的类型，并生成与 ssh-keygen -l 相同的 SHA256 指纹。 */
export function parseHostKey(key: Buffer): ParsedHostKey {
  let keyType = "unknown";
  if (key.length >= 4) {
    const typeLength = key.readUInt32BE(0);
    if (typeLength > 0 && typeLength <= 64 && key.length >= 4 + typeLength) {
      keyType = key.subarray(4, 4 + typeLength).toString("ascii");
    }
  }
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return {
    keyType,
    fingerprint: `SHA256:${digest}`,
    publicKey: key.toString("base64"),
  };
}

/**
 * 主机密钥校验：已信任且一致时直接放行；首次连接或密钥变化时请求用户确认，
 * 同一主机同一密钥的并发连接共享一次确认，避免终端与 SFTP 同时弹出多个窗口。
 */
export function createHostKeyVerification(dependencies: {
  repository: KnownHostsRepository;
  requestDecision: HostKeyDecisionRequester;
  probeHostKey?: HostKeyProbe;
  now?: () => number;
}) {
  const pendingDecisions = new Map<string, Promise<boolean>>();
  const pendingEnsures = new Map<string, Promise<void>>();
  const now = dependencies.now ?? Date.now;
  const probeHostKey = dependencies.probeHostKey ?? probeHostKeyWithSsh2;

  function requestTrust(target: HostKeyTarget, parsed: ParsedHostKey): Promise<boolean> {
    const hostId = getHostKeyId(target.host, target.port);
    const pendingKey = `${hostId}\u0000${parsed.fingerprint}`;
    const pending = pendingDecisions.get(pendingKey);
    if (pending) return pending;

    const previous = dependencies.repository.get(hostId);
    const decision = dependencies
      .requestDecision({
        requestId: randomUUID(),
        kind: previous ? "changed" : "unknown",
        host: target.host,
        port: target.port,
        serverName: target.serverName,
        keyType: parsed.keyType,
        fingerprint: parsed.fingerprint,
        previousKeyType: previous?.keyType,
        previousFingerprint: previous?.fingerprint,
      })
      .then(trust => {
        if (trust) {
          dependencies.repository.set(hostId, {
            keyType: parsed.keyType,
            fingerprint: parsed.fingerprint,
            publicKey: parsed.publicKey,
            trustedAt: now(),
          });
        }
        return trust;
      })
      .catch(() => false)
      .finally(() => pendingDecisions.delete(pendingKey));

    pendingDecisions.set(pendingKey, decision);
    return decision;
  }

  function createVerifier(target: HostKeyTarget): SshHostVerifier {
    return (key, verify) => {
      const parsed = parseHostKey(key);
      const known = dependencies.repository.get(getHostKeyId(target.host, target.port));

      if (known?.fingerprint === parsed.fingerprint && known.keyType === parsed.keyType) {
        verify(true);
        return;
      }

      void requestTrust(target, parsed).then(verify);
    };
  }

  /**
   * 首次连接前先探测并确认主机密钥，确认通过后正式连接才开始计时。
   * 已有信任记录时直接返回，由正式连接的校验函数比对密钥；用户拒绝时抛出错误。
   */
  function ensureTrusted(target: HostKeyTarget): Promise<void> {
    const hostId = getHostKeyId(target.host, target.port);
    if (dependencies.repository.get(hostId)) return Promise.resolve();

    const pending = pendingEnsures.get(hostId);
    if (pending) return pending;

    const ensure = (async () => {
      const key = await probeHostKey(target);
      if (!key) return;
      if (!(await requestTrust(target, parseHostKey(key)))) {
        throw new Error(HOST_KEY_REJECTED_MESSAGE);
      }
    })().finally(() => pendingEnsures.delete(hostId));

    pendingEnsures.set(hostId, ensure);
    return ensure;
  }

  return { createVerifier, requestTrust, ensureTrusted };
}

const PROBE_TIMEOUT_MS = 15_000;

/**
 * 只完成密钥交换取得主机公钥，随后立即拒绝握手。
 * 用户确认期间没有任何连接在等待，正式连接因此不会被 readyTimeout 打断。
 */
export const probeHostKeyWithSsh2: HostKeyProbe = target =>
  new Promise(resolve => {
    const client = new Client();
    let hostKey: Buffer | null = null;
    const finish = () => {
      client.removeAllListeners();
      client.on("error", () => undefined);
      client.end();
      resolve(hostKey);
    };
    client.once("error", finish).once("close", finish);
    try {
      client.connect({
        host: target.host,
        port: target.port,
        username: target.username || "orbitssh",
        readyTimeout: PROBE_TIMEOUT_MS,
        hostVerifier: (key: Buffer, verify: (permitted: boolean) => void) => {
          hostKey = Buffer.from(key);
          verify(false);
        },
      });
    } catch {
      resolve(null);
    }
  });

/** 把 ssh2 的英文校验失败信息转换为可操作的中文提示。 */
export function describeHostKeyError(error: unknown): string | null {
  return error instanceof Error && /Host denied \(verification failed\)/.test(error.message)
    ? HOST_KEY_REJECTED_MESSAGE
    : null;
}
