import { BrowserWindow, ipcMain } from "electron";
import Store from "electron-store";

import type { HostKeyPrompt, HostKeyPromptResponse } from "../../shared/host-key.js";
import type { ServerConfig } from "../../shared/server.js";
import { writeAppLog } from "../logger.js";
import { CachedStore } from "../storage/cached-store.js";
import {
  createHostKeyVerification,
  type KnownHostRecord,
  type KnownHostsRepository,
  type SshHostVerifier,
} from "./host-key-verification.js";

interface KnownHostsStoreSchema {
  hosts: Record<string, KnownHostRecord>;
}

// 用户长时间未处理时自动视为拒绝，避免挂起的确认永久占用同一主机的后续连接。
const PROMPT_TIMEOUT_MS = 2 * 60 * 1000;

// 每次 SSH 握手都会查询，读取走内存缓存，信任记录变更时同步写盘。
const store = new CachedStore<KnownHostsStoreSchema>(
  new Store<KnownHostsStoreSchema>({
    name: "known-hosts",
    defaults: { hosts: {} },
  }),
);

const repository: KnownHostsRepository = {
  get: hostId => store.read("hosts")[hostId],
  set: (hostId, record) => {
    store.write("hosts", { ...store.read("hosts"), [hostId]: { ...record } });
  },
};

interface PendingPrompt {
  prompt: HostKeyPrompt;
  webContentsId: number;
  resolve: (trust: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingPrompts = new Map<string, PendingPrompt>();

function settlePrompt(requestId: string, trust: boolean): void {
  const pending = pendingPrompts.get(requestId);
  if (!pending) return;
  pendingPrompts.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(trust);
  const window = BrowserWindow.getAllWindows().find(
    item => !item.isDestroyed() && item.webContents.id === pending.webContentsId,
  );
  window?.webContents.send("host-key:prompt-closed", requestId);
}

function requestDecision(prompt: HostKeyPrompt): Promise<boolean> {
  const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
  if (!window) return Promise.resolve(false);

  // 托盘隐藏或最小化时也必须让用户看到确认窗口，第三方 MCP 调用同样经过这里。
  if (!window.isVisible()) window.show();
  if (window.isMinimized()) window.restore();
  window.focus();

  writeAppLog({
    scope: "main.ssh",
    level: prompt.kind === "changed" ? "warn" : "info",
    message:
      prompt.kind === "changed" ? "主机密钥与已信任记录不一致" : "首次连接，等待确认主机密钥",
    data: {
      host: prompt.host,
      port: prompt.port,
      keyType: prompt.keyType,
      fingerprint: prompt.fingerprint,
      previousFingerprint: prompt.previousFingerprint,
    },
  });

  return new Promise(resolve => {
    const timer = setTimeout(() => settlePrompt(prompt.requestId, false), PROMPT_TIMEOUT_MS);
    timer.unref();
    pendingPrompts.set(prompt.requestId, {
      prompt,
      webContentsId: window.webContents.id,
      resolve,
      timer,
    });
    window.webContents.send("host-key:prompt", prompt);
  });
}

const verification = createHostKeyVerification({ repository, requestDecision });

type HostKeyServer = Pick<ServerConfig, "host" | "port" | "name" | "username">;

function toTarget(server: HostKeyServer) {
  return {
    host: server.host,
    port: server.port,
    serverName: server.name,
    username: server.username,
  };
}

/** 首次连接的主机先完成密钥确认，用户拒绝时抛出错误，正式连接不会开始。 */
export function ensureServerHostKeyTrusted(server: HostKeyServer): Promise<void> {
  return verification.ensureTrusted(toTarget(server));
}

export function createServerHostVerifier(server: HostKeyServer): SshHostVerifier {
  return verification.createVerifier(toTarget(server));
}

function normalizeResponse(input: unknown): HostKeyPromptResponse {
  const record = input as Partial<HostKeyPromptResponse> | null;
  if (
    !record ||
    typeof record !== "object" ||
    typeof record.requestId !== "string" ||
    typeof record.trust !== "boolean"
  ) {
    throw new Error("主机密钥确认参数无效");
  }
  return { requestId: record.requestId, trust: record.trust };
}

export function registerHostKeyIpc(): void {
  // 渲染进程刷新后需要重新展示尚未处理的确认，避免连接一直等待。
  ipcMain.handle("host-key:list-pending", event =>
    Array.from(pendingPrompts.values())
      .filter(pending => pending.webContentsId === event.sender.id)
      .map(pending => pending.prompt),
  );

  ipcMain.handle("host-key:respond", (event, input: unknown) => {
    const response = normalizeResponse(input);
    const pending = pendingPrompts.get(response.requestId);
    if (!pending || pending.webContentsId !== event.sender.id) return false;
    writeAppLog({
      scope: "main.ssh",
      level: response.trust && pending.prompt.kind === "changed" ? "warn" : "info",
      message: response.trust ? "用户已信任主机密钥" : "用户拒绝信任主机密钥",
      data: {
        host: pending.prompt.host,
        port: pending.prompt.port,
        kind: pending.prompt.kind,
        fingerprint: pending.prompt.fingerprint,
      },
    });
    settlePrompt(response.requestId, response.trust);
    return true;
  });
}
