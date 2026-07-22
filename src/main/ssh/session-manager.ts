import type { WebContents } from "electron";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import { Client, type ClientChannel } from "ssh2";

import { writeAppLog } from "../logger.js";
import { createServerConnectOptions } from "./auth-options.js";
import {
  getIdleDisconnectMs,
  getSshConnectionOptions,
} from "./connection-options.js";
import { getServerAuthConfig } from "../storage/server-store.js";
import type {
  TerminalSessionKind,
  TerminalOpenResult,
  TerminalInputLockEvent,
  TerminalResizeInput,
  TerminalStatusEvent,
} from "../../shared/terminal.js";
import { LOCAL_TERMINAL_SERVER_ID } from "../../shared/terminal.js";
import type { AiCommandResult } from "../../shared/ai.js";
import {
  executeLocalTerminalCommand,
  executeSshTextCommand,
  executeSshTerminalCommand,
} from "./terminal-command.js";
import {
  clearRemoteSystemStatsCache,
  collectTerminalSystemStats,
  type RemoteSystemStats,
} from "./terminal-system-stats.js";
import { normalizeTerminalOutputForXterm } from "./terminal-output.js";

export type { RemoteSystemStats } from "./terminal-system-stats.js";

interface BaseTerminalSession {
  tabId: string;
  serverId: string;
  kind: TerminalSessionKind;
  webContents: WebContents;
  status: TerminalStatusEvent["status"];
  lastActiveAt: number;
  outputBuffer: string;
  aiInputLocked: boolean;
}

interface SshTerminalSession extends BaseTerminalSession {
  kind: "ssh";
  sshClient: Client;
  shellStream?: ClientChannel;
  outputDecoder: StringDecoder;
}

interface LocalTerminalSession extends BaseTerminalSession {
  kind: "local";
  cwd: string;
  localPty: IPty;
}

type TerminalSession = SshTerminalSession | LocalTerminalSession;

const terminalSessions = new Map<string, TerminalSession>();
const pathIntegrationInstallDelayMs = 120;
const idleDisconnectCheckIntervalMs = 30_000;
const maxTerminalOutputBufferChars = 12_000;

function appendTerminalOutput(session: BaseTerminalSession, chunk: string): void {
  session.outputBuffer = `${session.outputBuffer}${chunk}`.slice(
    -maxTerminalOutputBufferChars,
  );
}

export interface TerminalContextSnapshot {
  tabId: string;
  serverId: string;
  status: TerminalStatusEvent["status"];
  recentOutput: string;
}

export function getTerminalContextSnapshot(
  tabId: string,
): TerminalContextSnapshot | null {
  const session = terminalSessions.get(tabId);

  if (!session) {
    return null;
  }

  return {
    tabId: session.tabId,
    serverId: session.serverId,
    status: session.status,
    recentOutput: session.outputBuffer,
  };
}

function setAiTerminalInputLocked(
  session: TerminalSession,
  locked: boolean,
): void {
  if (session.aiInputLocked === locked) return;
  session.aiInputLocked = locked;
  if (session.webContents.isDestroyed()) return;
  session.webContents.send("terminal:input-lock", {
    tabId: session.tabId,
    locked,
    owner: "ai",
  } satisfies TerminalInputLockEvent);
}

function writeRawTerminalInput(session: TerminalSession, data: string): void {
  if (session.kind === "local") {
    session.localPty.write(data);
    return;
  }
  session.shellStream?.write(Buffer.from(data, "utf8"));
}

async function restoreInteractivePrompt(session: TerminalSession): Promise<void> {
  if (
    !isCurrentTerminalSession(session) ||
    session.status !== "connected"
  ) {
    return;
  }

  // AI 命令运行在独立 exec channel；向交互 Shell 发送 Ctrl+C，
  // 让 readline 清空空输入并重新输出真实提示符。
  writeRawTerminalInput(session, "\x03");
  await new Promise(resolve => setTimeout(resolve, 120));
}

function createAiTerminalOutputForwarder(session: TerminalSession): {
  write: (chunk: string) => void;
  flush: () => void;
} {
  let pendingCarriageReturn = false;

  return {
    write(chunk: string): void {
      if (!chunk) return;
      let value = pendingCarriageReturn ? `\r${chunk}` : chunk;
      pendingCarriageReturn = value.endsWith("\r");
      if (pendingCarriageReturn) value = value.slice(0, -1);
      if (!value) return;
      forwardTerminalData(
        session,
        normalizeTerminalOutputForXterm(value),
        false,
      );
    },
    flush(): void {
      if (!pendingCarriageReturn) return;
      pendingCarriageReturn = false;
      forwardTerminalData(session, "\r", false);
    },
  };
}

export async function executeTerminalCommand(
  tabId: string,
  command: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AiCommandResult> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const signal = options.signal;
  const session = terminalSessions.get(tabId);

  if (!session) {
    throw new Error("Terminal session does not exist");
  }

  if (session.status !== "connected") {
    throw new Error("终端会话未连接");
  }

  if (session.aiInputLocked) {
    throw new Error("当前终端已有另一个 AI 会话正在执行命令，请等待完成后重试");
  }

  const terminalCommand = command.replace(/[\r\n]/g, " ").trim();
  const outputForwarder = createAiTerminalOutputForwarder(session);
  setAiTerminalInputLocked(session, true);

  try {
    forwardTerminalData(
      session,
      `\r\n[AI] $ ${terminalCommand}\r\n`,
      false,
    );
    const execution = session.kind === "local"
      ? executeLocalTerminalCommand(
          session.cwd,
          command,
          timeoutMs,
          signal,
          chunk => outputForwarder.write(chunk),
        )
      : executeSshTerminalCommand(
          session.sshClient,
          command,
          timeoutMs,
          signal,
          chunk => outputForwarder.write(chunk),
        );
    const result = await execution;
    outputForwarder.flush();
    const status = result.timedOut
      ? "command timed out"
      : `exit code ${result.exitCode ?? "unknown"}`;
    forwardTerminalData(session, `\r\n[AI] ${status}\r\n`, false);
    await restoreInteractivePrompt(session);
    return result;
  } catch (error) {
    outputForwarder.flush();
    const message = error instanceof Error ? error.message : String(error);
    forwardTerminalData(
      session,
      `\r\n[AI] command failed: ${normalizeTerminalOutputForXterm(message)}\r\n`,
      false,
    );
    await restoreInteractivePrompt(session);
    throw error;
  } finally {
    setAiTerminalInputLocked(session, false);
  }
}

function getDefaultLocalCwd(): string {
  if (process.platform === "win32") {
    return "C:\\";
  }

  return os.homedir() || process.cwd();
}

function getLocalShellConfig(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      shell: process.env.ORBITSSH_LOCAL_SHELL || "powershell.exe",
      args: ["-NoLogo"],
    };
  }

  return {
    shell: process.env.SHELL || "/bin/sh",
    args: [],
  };
}

function createLocalPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  // 明确声明终端能力，保证本地 shell 的颜色和控制序列按 xterm 处理。
  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";

  return env;
}

export async function getRemoteSystemStats(
  tabId: string,
): Promise<RemoteSystemStats> {
  const session = terminalSessions.get(tabId);

  if (!session) {
    throw new Error("终端会话不存在");
  }

  if (session.status !== "connected") {
    throw new Error("SSH 未连接");
  }

  return collectTerminalSystemStats(
    tabId,
    session.kind === "local"
      ? { kind: "local", cwd: session.cwd }
      : { kind: "ssh", sshClient: session.sshClient },
  );
}

export function clearRemoteOSCache(tabId: string): void {
  clearRemoteSystemStatsCache(tabId);
}

function sendStatus(
  session: TerminalSession,
  status: TerminalStatusEvent["status"],
  message?: string,
): void {
  session.status = status;
  writeAppLog({
    scope: "main.ssh",
    message: "终端状态变更",
    data: {
      tabId: session.tabId,
      serverId: session.serverId,
      status,
      message,
    },
  });
  session.webContents.send("terminal:status", {
    tabId: session.tabId,
    status,
    message,
  } satisfies TerminalStatusEvent);
}

function touchTerminalSession(session: BaseTerminalSession): void {
  session.lastActiveAt = Date.now();
}

// 判断回调所属会话是否仍是当前有效会话，避免旧连接事件影响新连接。
function isCurrentTerminalSession(session: BaseTerminalSession): boolean {
  return terminalSessions.get(session.tabId) === session;
}

export function assertTerminalSessionAccess(
  tabId: string,
  webContents: WebContents,
  options: { allowMissing?: boolean } = {},
): void {
  if (typeof tabId !== "string" || !tabId.trim()) {
    throw new Error("终端标签页 ID 无效");
  }

  const session = terminalSessions.get(tabId);

  if (!session) {
    if (options.allowMissing) {
      return;
    }

    throw new Error("终端会话不存在");
  }

  if (session.webContents !== webContents) {
    throw new Error("终端会话不属于当前窗口");
  }
}

function sendTerminalStatusToWebContents(
  webContents: WebContents,
  tabId: string,
  status: TerminalStatusEvent["status"],
  message?: string,
): void {
  // 会话不存在时也要回写状态，避免 Renderer 停留在连接中。
  webContents.send("terminal:status", {
    tabId,
    status,
    message,
  } satisfies TerminalStatusEvent);
}

function closeIdleTerminalSessions(): void {
  const idleDisconnectMs = getIdleDisconnectMs();

  if (idleDisconnectMs <= 0) {
    return;
  }

  const now = Date.now();

  for (const session of terminalSessions.values()) {
    if (session.kind !== "ssh" || session.status !== "connected") {
      continue;
    }

    if (now - session.lastActiveAt < idleDisconnectMs) {
      continue;
    }

    writeAppLog({
      scope: "main.ssh",
      message: "SSH 会话因空闲超时关闭",
      data: {
        tabId: session.tabId,
        serverId: session.serverId,
        idleMs: now - session.lastActiveAt,
      },
    });
    sendStatus(session, "disconnected", "连接因长时间未操作已断开");
    closeTerminalSession(session.tabId);
  }
}

const terminalIdleDisconnectTimer = setInterval(
  closeIdleTerminalSessions,
  idleDisconnectCheckIntervalMs,
);
terminalIdleDisconnectTimer.unref?.();

function createSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "SSH 连接失败";
}

function createSshShellEnv(): NodeJS.ProcessEnv {
  return {
    LANG: "en_US.UTF-8",
    LC_CTYPE: "en_US.UTF-8",
    LC_ALL: "",
    CLICOLOR: "1",
  };
}

function forwardTerminalData(
  session: BaseTerminalSession,
  data: string,
  includeInContext = true,
): void {
  if (!isCurrentTerminalSession(session)) {
    return;
  }

  touchTerminalSession(session);

  if (!data) {
    return;
  }

  if (includeInContext) {
    appendTerminalOutput(session, data);
  }
  session.webContents.send("terminal:data", {
    tabId: session.tabId,
    data,
  });
}

function forwardSshShellData(
  session: SshTerminalSession,
  data: string,
): void {
  forwardTerminalData(session, data);
}

function forwardSshShellBuffer(
  session: SshTerminalSession,
  data: Buffer,
): void {
  // SSH 输出可能把一个中文 UTF-8 字符拆成多个 Buffer，必须流式解码。
  const decoded = session.outputDecoder.write(data);
  forwardSshShellData(session, decoded);
}

function installShellPathIntegration(session: SshTerminalSession): void {
  setTimeout(() => {
    if (!terminalSessions.has(session.tabId)) {
      return;
    }

    void executeSshTextCommand(session.sshClient, "pwd", 3000)
      .then((path) => {
        if (!terminalSessions.has(session.tabId) || !path.startsWith("/")) {
          return;
        }

        session.webContents.send("terminal:data", {
          tabId: session.tabId,
          data: `\x1b]7;file://${path}\x07`,
        });
      })
      .catch((error) => {
        writeAppLog({
          scope: "main.ssh",
          level: "warn",
          message: "初始化终端路径同步失败",
          data: {
            tabId: session.tabId,
            serverId: session.serverId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
  }, pathIntegrationInstallDelayMs);

  writeAppLog({
    scope: "main.ssh",
    message: "已调度终端路径同步",
    data: { tabId: session.tabId, serverId: session.serverId },
  });
}

function createLocalTerminalSession(
  webContents: WebContents,
  tabId: string = crypto.randomUUID(),
  outputBuffer = "",
): TerminalOpenResult {
  const startedAt = Date.now();
  const cwd = getDefaultLocalCwd();
  const { shell, args } = getLocalShellConfig();

  writeAppLog({
    scope: "main.ssh",
    message: "开始创建本地终端会话",
    data: { tabId, cwd, shell },
  });

  const localPty = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: createLocalPtyEnv(),
  });

  const session: LocalTerminalSession = {
    tabId,
    serverId: LOCAL_TERMINAL_SERVER_ID,
    kind: "local",
    webContents,
    cwd,
    localPty,
    status: "connecting",
    lastActiveAt: Date.now(),
    outputBuffer,
    aiInputLocked: false,
  };

  terminalSessions.set(tabId, session);
  sendStatus(session, "connecting");

  localPty.onData(data => {
    forwardTerminalData(session, data);
  });

  localPty.onExit(event => {
    if (!isCurrentTerminalSession(session)) {
      return;
    }

    writeAppLog({
      scope: "main.ssh",
      message: "本地终端会话已退出",
      data: { tabId, exitCode: event.exitCode, signal: event.signal },
    });
    sendStatus(session, "disconnected");
    setAiTerminalInputLocked(session, false);
    terminalSessions.delete(tabId);
    clearRemoteSystemStatsCache(tabId);
  });

  sendStatus(session, "connected");
  writeAppLog({
    scope: "main.ssh",
    message: "本地终端会话已创建",
    data: { tabId, cwd, shell, totalMs: Date.now() - startedAt },
  });

  return {
    tabId,
    serverId: LOCAL_TERMINAL_SERVER_ID,
    kind: "local",
    cwd,
  };
}

export function openLocalTerminalSession(webContents: WebContents): TerminalOpenResult {
  try {
    return createLocalTerminalSession(webContents);
  } catch (error) {
    const message = createSafeErrorMessage(error);
    writeAppLog({
      scope: "main.ssh",
      level: "error",
      message: "本地终端会话创建失败",
      data: { error: message },
    });
    throw new Error(`本地终端打开失败：${message}`);
  }
}

// 创建 SSH shell session，输入输出统一通过 IPC 转发给对应 Renderer。
export function openTerminalSession(
  webContents: WebContents,
  serverId: string,
): TerminalOpenResult {
  const startedAt = Date.now();
  const server = getServerAuthConfig(serverId);
  const authLoadedAt = Date.now();
  const tabId = crypto.randomUUID();
  const sshClient = new Client();
  const session: SshTerminalSession = {
    tabId,
    serverId,
    kind: "ssh",
    webContents,
    sshClient,
    outputDecoder: new StringDecoder("utf8"),
    status: "connecting",
    lastActiveAt: Date.now(),
    outputBuffer: "",
    aiInputLocked: false,
  };

  terminalSessions.set(tabId, session);
  writeAppLog({
    scope: "main.ssh",
    message: "开始创建 SSH 会话",
    data: {
      tabId,
      serverId,
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      authLoadMs: authLoadedAt - startedAt,
    },
  });
  sendStatus(session, "connecting");

  sshClient
    .on("ready", () => {
      const readyAt = Date.now();
      writeAppLog({
        scope: "main.ssh",
        message: "SSH 已 ready，开始打开 shell",
        data: {
          tabId,
          serverId,
          connectReadyMs: readyAt - startedAt,
          afterConnectCallMs: readyAt - authLoadedAt,
        },
      });
      sshClient.shell(
        {
          term: "xterm-256color",
          cols: 80,
          rows: 24,
        },
        { env: createSshShellEnv() },
        (error, stream) => {
          if (error) {
            sendStatus(session, "error", createSafeErrorMessage(error));
            closeTerminalSession(tabId);
            return;
          }

          session.shellStream = stream;
          const shellOpenedAt = Date.now();
          writeAppLog({
            scope: "main.ssh",
            message: "SSH shell 已打开",
            data: {
              tabId,
              serverId,
              shellOpenMs: shellOpenedAt - readyAt,
              totalMs: shellOpenedAt - startedAt,
            },
          });
          sendStatus(session, "connected");

          stream.on("data", (data: Buffer) => {
            forwardSshShellBuffer(session, data);
          });

          stream.on("close", () => {
            if (!isCurrentTerminalSession(session)) {
              return;
            }

            sendStatus(session, "disconnected");
            closeTerminalSession(tabId);
          });

          installShellPathIntegration(session);
        },
      );
    })
    .on("error", error => {
      writeAppLog({
        scope: "main.ssh",
        level: "error",
        message: "SSH 会话错误",
        data: { tabId, serverId, error: createSafeErrorMessage(error) },
      });
      sendStatus(session, "error", createSafeErrorMessage(error));
      closeTerminalSession(tabId);
    })
    .on("close", () => {
      if (isCurrentTerminalSession(session)) {
        sendStatus(session, "disconnected");
        setAiTerminalInputLocked(session, false);
        terminalSessions.delete(tabId);
        clearRemoteSystemStatsCache(tabId);
      }
    });

  writeAppLog({
    scope: "main.ssh",
    message: "SSH connect 已调度",
    data: { tabId, serverId, scheduleMs: Date.now() - startedAt },
  });

  setImmediate(() => {
    const connectStartedAt = Date.now();
    writeAppLog({
      scope: "main.ssh",
      message: "开始执行 SSH connect",
      data: {
        tabId,
        serverId,
        delayAfterScheduleMs: connectStartedAt - startedAt,
      },
    });

    sshClient.connect({
      ...createServerConnectOptions(server),
      ...getSshConnectionOptions(),
    });
  });

  return {
    tabId,
    serverId,
    kind: "ssh",
  };
}

export function writeTerminalInput(tabId: string, data: string): boolean {
  const session = terminalSessions.get(tabId);

  if (!session || typeof data !== "string") {
    return false;
  }

  if (session.aiInputLocked) {
    return false;
  }

  touchTerminalSession(session);
  writeRawTerminalInput(session, data);
  return true;
}

export function resizeTerminal(input: TerminalResizeInput): void {
  const session = terminalSessions.get(input.tabId);

  if (!session) {
    return;
  }

  if (!Number.isInteger(input.cols) || !Number.isInteger(input.rows)) {
    return;
  }

  if (session.kind === "local") {
    session.localPty.resize(input.cols, input.rows);
    return;
  }

  session.shellStream?.setWindow(input.rows, input.cols, 0, 0);
}

export function closeTerminalSession(tabId: string): void {
  const session = terminalSessions.get(tabId);

  if (!session) {
    return;
  }

  setAiTerminalInputLocked(session, false);
  terminalSessions.delete(tabId);
  clearRemoteSystemStatsCache(tabId);
  if (session.kind === "local") {
    session.localPty.kill();
  } else {
    session.shellStream?.end();
    session.sshClient.end();
  }
  writeAppLog({
    scope: "main.ssh",
    message: session.kind === "local" ? "本地终端会话已关闭" : "SSH 会话已关闭",
    data: { tabId, serverId: session.serverId, kind: session.kind },
  });
}

// 重新连接终端会话：优先复用现有会话信息；断线清理后用 Renderer 传回的 serverId 恢复连接。
export function reconnectTerminalSession(
  webContents: WebContents,
  tabId: string,
  fallbackServerId?: string,
): boolean {
  const existing = terminalSessions.get(tabId);

  const serverId = existing?.serverId ?? fallbackServerId;

  if (!serverId) {
    const message = "重连失败：终端会话不存在";
    writeAppLog({
      scope: "main.ssh",
      level: "warn",
      message,
      data: { tabId },
    });
    sendTerminalStatusToWebContents(webContents, tabId, "error", message);
    return false;
  }

  if (existing?.kind === "local" || serverId === LOCAL_TERMINAL_SERVER_ID) {
    const outputBuffer = existing?.outputBuffer ?? "";
    const sessionWebContents = existing?.webContents ?? webContents;

    if (existing?.kind === "local") {
      setAiTerminalInputLocked(existing, false);
      terminalSessions.delete(tabId);
      existing.localPty.kill();
    }

    try {
      createLocalTerminalSession(sessionWebContents, tabId, outputBuffer);
      return true;
    } catch (error) {
      const message = `本地终端重连失败：${createSafeErrorMessage(error)}`;
      writeAppLog({
        scope: "main.ssh",
        level: "error",
        message,
        data: { tabId },
      });
      sendTerminalStatusToWebContents(sessionWebContents, tabId, "error", message);
      return false;
    }
  }

  let server: ReturnType<typeof getServerAuthConfig>;

  try {
    server = getServerAuthConfig(serverId);
  } catch (error) {
    const message = `重连失败：${createSafeErrorMessage(error)}`;
    writeAppLog({
      scope: "main.ssh",
      level: "error",
      message,
      data: { tabId, serverId },
    });
    sendTerminalStatusToWebContents(webContents, tabId, "error", message);
    return false;
  }

  const startedAt = Date.now();
  const sessionWebContents = existing?.webContents ?? webContents;
  const outputBuffer = existing?.outputBuffer ?? "";

  // 清理旧连接资源；后续 close 回调通过会话身份判断，避免误删新连接。
  if (existing?.kind === "ssh") {
    setAiTerminalInputLocked(existing, false);
    existing.shellStream?.end();
    existing.sshClient.end();
  }
  clearRemoteSystemStatsCache(tabId);

  writeAppLog({
    scope: "main.ssh",
    message: "开始重连 SSH 会话",
    data: { tabId, serverId, host: server.host, port: server.port },
  });

  const sshClient = new Client();
  const session: SshTerminalSession = {
    tabId,
    serverId,
    kind: "ssh",
    webContents: sessionWebContents,
    sshClient,
    outputDecoder: new StringDecoder("utf8"),
    status: "connecting",
    lastActiveAt: Date.now(),
    outputBuffer,
    aiInputLocked: false,
  };

  terminalSessions.set(tabId, session);
  sendStatus(session, "connecting");

  sshClient
    .on("ready", () => {
      const readyAt = Date.now();
      writeAppLog({
        scope: "main.ssh",
        message: "SSH 重连已 ready，开始打开 shell",
        data: { tabId, serverId, connectReadyMs: readyAt - startedAt },
      });
      sshClient.shell(
        { term: "xterm-256color", cols: 80, rows: 24 },
        { env: createSshShellEnv() },
        (error, stream) => {
          if (error) {
            sendStatus(session, "error", createSafeErrorMessage(error));
            closeTerminalSession(tabId);
            return;
          }

          session.shellStream = stream;
          writeAppLog({
            scope: "main.ssh",
            message: "SSH 重连 shell 已打开",
            data: { tabId, serverId, totalMs: Date.now() - startedAt },
          });
          sendStatus(session, "connected");

          stream.on("data", (data: Buffer) => {
            forwardSshShellBuffer(session, data);
          });

          stream.on("close", () => {
            if (!isCurrentTerminalSession(session)) {
              return;
            }

            sendStatus(session, "disconnected");
            closeTerminalSession(tabId);
          });

          installShellPathIntegration(session);
        },
      );
    })
    .on("error", error => {
      writeAppLog({
        scope: "main.ssh",
        level: "error",
        message: "SSH 重连错误",
        data: { tabId, serverId, error: createSafeErrorMessage(error) },
      });
      sendStatus(session, "error", createSafeErrorMessage(error));
      closeTerminalSession(tabId);
    })
    .on("close", () => {
      if (isCurrentTerminalSession(session)) {
        sendStatus(session, "disconnected");
        setAiTerminalInputLocked(session, false);
        terminalSessions.delete(tabId);
        clearRemoteSystemStatsCache(tabId);
      }
    });

  setImmediate(() => {
    try {
      sshClient.connect({
        ...createServerConnectOptions(server),
        ...getSshConnectionOptions(),
      });
    } catch (error) {
      sendStatus(session, "error", createSafeErrorMessage(error));
      closeTerminalSession(tabId);
    }
  });

  return true;
}

export function closeAllTerminalSessions(): void {
  for (const tabId of terminalSessions.keys()) {
    closeTerminalSession(tabId);
  }
}
