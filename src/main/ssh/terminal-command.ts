import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { type Client, type ClientChannel } from "ssh2";

import type { AiCommandResult } from "../../shared/ai.js";

const execAsync = promisify(exec);

export type TerminalCommandOutputHandler = (
  stream: "stdout" | "stderr",
  text: string,
) => void;

function createCommandAbortError(): Error {
  const error = new Error("命令执行已终止");
  error.name = "AbortError";
  return error;
}

/** 使用单引号生成不可被 Shell 重新解释的 POSIX 参数。 */
export function quotePosixShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** 为独立 SSH exec Channel 显式绑定目录，避免误用交互终端的隐式 cwd。 */
export function buildSshCommandInWorkingDirectory(
  command: string,
  workingDirectory?: string,
): string {
  if (!workingDirectory) return command;
  return `cd -- ${quotePosixShellArgument(workingDirectory)} && ${command}`;
}

/**
 * 在 SSH exec Channel 中执行 AI 命令，并在取消或超时时主动释放远端资源。
 */
export function executeSshTerminalCommand(
  sshClient: Client,
  command: string,
  timeoutMs: number,
  signal?: AbortSignal,
  workingDirectory?: string,
  onOutput?: TerminalCommandOutputHandler,
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
      const text = data.toString("utf8");
      stdout = `${stdout}${text}`.slice(-20_000);
      onOutput?.("stdout", text);
    };
    const onStderr = (data: Buffer): void => {
      const text = data.toString("utf8");
      stderr = `${stderr}${text}`.slice(-10_000);
      onOutput?.("stderr", text);
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

    const effectiveCommand = buildSshCommandInWorkingDirectory(
      command,
      workingDirectory,
    );
    sshClient.exec(effectiveCommand, (error, openedStream) => {
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
  onOutput?: TerminalCommandOutputHandler,
): Promise<AiCommandResult> {
  if (onOutput) {
    return executeStreamingLocalTerminalCommand(
      cwd,
      command,
      timeoutMs,
      signal,
      onOutput,
    );
  }

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

/** 本地长命令使用 ChildProcess 流式收集输出，同时保留超时和取消语义。 */
function executeStreamingLocalTerminalCommand(
  cwd: string,
  command: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onOutput: TerminalCommandOutputHandler,
): Promise<AiCommandResult> {
  if (signal?.aborted) {
    return Promise.reject(createCommandAbortError());
  }

  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
    });
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const appendOutput = (
      stream: "stdout" | "stderr",
      data: string | Buffer,
    ): void => {
      const text = data.toString();
      if (stream === "stdout") {
        stdout = `${stdout}${text}`.slice(-20_000);
      } else {
        stderr = `${stderr}${text}`.slice(-10_000);
      }
      onOutput(stream, text);
    };
    const onAbort = (): void => {
      child.kill();
      fail(createCommandAbortError());
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", data => appendOutput("stdout", data));
    child.stderr?.on("data", data => appendOutput("stderr", data));
    child.on("error", fail);
    child.on("close", code => finish(code));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
