import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { type Client, type ClientChannel } from "ssh2";

import type { AiCommandResult } from "../../shared/ai.js";

export type TerminalCommandOutputHandler = (
  chunk: string,
  stream: "stdout" | "stderr",
) => void;

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
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let decodersFlushed = false;

    const onStdout = (data: Buffer): void => {
      const chunk = stdoutDecoder.write(data);
      stdout = `${stdout}${chunk}`.slice(-20_000);
      if (chunk) onOutput?.(chunk, "stdout");
    };
    const onStderr = (data: Buffer): void => {
      const chunk = stderrDecoder.write(data);
      stderr = `${stderr}${chunk}`.slice(-10_000);
      if (chunk) onOutput?.(chunk, "stderr");
    };
    const flushDecoders = (): void => {
      if (decodersFlushed) return;
      decodersFlushed = true;
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      if (stdoutTail) {
        stdout = `${stdout}${stdoutTail}`.slice(-20_000);
        onOutput?.(stdoutTail, "stdout");
      }
      if (stderrTail) {
        stderr = `${stderr}${stderrTail}`.slice(-10_000);
        onOutput?.(stderrTail, "stderr");
      }
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
      flushDecoders();
      cleanup();
      resolve({
        ...result,
        stdout: stdout.slice(-20_000),
        stderr: stderr.slice(-10_000),
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

/** 在本地子进程中执行 AI 命令，输出直接流式转发，不受 exec 缓冲上限影响。 */
export async function executeLocalTerminalCommand(
  cwd: string,
  command: string,
  timeoutMs: number,
  signal?: AbortSignal,
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
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const appendOutput = (
      data: Buffer,
      stream: "stdout" | "stderr",
    ): void => {
      const decoder = stream === "stdout" ? stdoutDecoder : stderrDecoder;
      const value = decoder.write(data);
      if (!value) return;
      if (stream === "stdout") {
        stdout = `${stdout}${value}`.slice(-20_000);
      } else {
        stderr = `${stderr}${value}`.slice(-10_000);
      }
      onOutput?.(value, stream);
    };
    const flushDecoders = (): void => {
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      if (stdoutTail) {
        stdout = `${stdout}${stdoutTail}`.slice(-20_000);
        onOutput?.(stdoutTail, "stdout");
      }
      if (stderrTail) {
        stderr = `${stderr}${stderrTail}`.slice(-10_000);
        onOutput?.(stderrTail, "stderr");
      }
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
    };
    const finish = (
      exitCode: number | null,
      timedOut: boolean,
    ): void => {
      if (settled) return;
      settled = true;
      flushDecoders();
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
    const stopChild = (): void => {
      if (!child.killed) child.kill();
    };
    const onAbort = (): void => {
      fail(createCommandAbortError());
      stopChild();
    };
    const timer = setTimeout(() => {
      finish(null, true);
      stopChild();
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", data => appendOutput(data as Buffer, "stdout"));
    child.stderr.on("data", data => appendOutput(data as Buffer, "stderr"));
    child.on("error", fail);
    child.on("close", code => finish(code, false));
  });
}
