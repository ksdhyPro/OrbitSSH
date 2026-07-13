import { exec } from "node:child_process";
import { promisify } from "node:util";
import { type Client, type ClientChannel } from "ssh2";

import type { AiCommandResult } from "../../shared/ai.js";

const execAsync = promisify(exec);

function createCommandAbortError(): Error {
  const error = new Error("命令执行已终止");
  error.name = "AbortError";
  return error;
}

/**
 * 在 SSH exec Channel 中执行 AI 命令，并在取消或超时时主动释放远端资源。
 */
export function executeSshTerminalCommand(
  sshClient: Client,
  command: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AiCommandResult> {
  if (signal?.aborted) {
    return Promise.reject(createCommandAbortError());
  }

  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stream: ClientChannel | undefined;

    const onStdout = (data: Buffer): void => {
      stdout = `${stdout}${data.toString("utf8")}`.slice(-20_000);
    };
    const onStderr = (data: Buffer): void => {
      stderr = `${stderr}${data.toString("utf8")}`.slice(-10_000);
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      stream?.removeListener("data", onStdout);
      stream?.stderr.removeListener("data", onStderr);
      stream?.removeListener("close", onClose);
      stream?.removeListener("error", onStreamError);
    };
    const stopRemoteCommand = (): void => {
      if (!stream) return;
      try {
        stream.signal("INT");
      } catch {
        // 部分 SSH 服务端不支持 signal 请求，仍继续关闭 Channel。
      }
      stream.close();
      stream.destroy();
    };
    const finish = (result: Omit<AiCommandResult, "durationMs">): void => {
      if (settled) return;

      settled = true;
      cleanup();
      resolve({
        ...result,
        stdout: result.stdout.slice(0, 20_000),
        stderr: result.stderr.slice(0, 10_000),
        durationMs: Date.now() - startedAt,
      });
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      fail(createCommandAbortError());
      stopRemoteCommand();
    };
    const onClose = (code?: number): void => {
      finish({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : null,
        timedOut: false,
      });
    };
    const onStreamError = (streamError: Error): void => {
      fail(streamError);
    };
    const timer = setTimeout(() => {
      finish({
        stdout,
        stderr,
        exitCode: null,
        timedOut: true,
      });
      stopRemoteCommand();
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    sshClient.exec(command, (error, openedStream) => {
      if (error) {
        fail(error);
        return;
      }

      stream = openedStream;
      if (settled) {
        stopRemoteCommand();
        return;
      }

      stream.on("data", onStdout);
      stream.stderr.on("data", onStderr);
      stream.on("close", onClose);
      stream.on("error", onStreamError);
    });
  });
}

/** 执行内部只读 SSH 命令并返回文本，供路径探测等主进程流程复用。 */
export async function executeSshTextCommand(
  sshClient: Client,
  command: string,
  timeoutMs: number,
): Promise<string> {
  const result = await executeSshTerminalCommand(
    sshClient,
    command,
    timeoutMs,
  );

  if (result.timedOut) {
    throw new Error("远端命令超时");
  }

  return result.stdout.trim() || result.stderr.trim();
}

/** 在本地子进程中执行 AI 命令，复用 Node 原生的超时与 AbortSignal。 */
export async function executeLocalTerminalCommand(
  cwd: string,
  command: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AiCommandResult> {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 30_000,
      signal,
    });

    return {
      stdout: stdout.slice(0, 20_000),
      stderr: stderr.slice(0, 10_000),
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw createCommandAbortError();
    }

    const record = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };

    return {
      stdout: String(record.stdout ?? "").slice(0, 20_000),
      stderr: String(
        record.stderr ?? (error instanceof Error ? error.message : ""),
      ).slice(0, 10_000),
      exitCode: typeof record.code === "number" ? record.code : null,
      timedOut: Boolean(record.killed),
      durationMs: Date.now() - startedAt,
    };
  }
}
