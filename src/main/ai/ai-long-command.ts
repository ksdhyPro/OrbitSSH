import type { AiCommandResult } from "../../shared/ai.js";
import type { AiLongCommandProgressContext } from "./ai-context.js";

export const LONG_COMMAND_REPORT_INTERVAL_MS = 30_000;
export const LONG_COMMAND_TIMEOUT_MS = 60 * 60 * 1000;

interface RunLongCommandMonitorOptions {
  toolCallId: string;
  command: string;
  reason: string;
  risk: "low" | "medium" | "high";
  signal: AbortSignal;
  reportIntervalMs?: number;
  execute: (
    onOutput: (stream: "stdout" | "stderr", text: string) => void,
  ) => Promise<AiCommandResult>;
  onProgress: (
    progress: AiLongCommandProgressContext,
    signal: AbortSignal,
  ) => Promise<void>;
}

type CompletionEvent =
  | { type: "completed"; result: AiCommandResult }
  | { type: "failed"; error: unknown };

function createAbortError(): Error {
  const error = new Error("命令执行已终止");
  error.name = "AbortError";
  return error;
}

function appendTail(current: string, chunk: string, limit: number): string {
  return `${current}${chunk}`.slice(-limit);
}

/** 等待命令终态，并以固定频率把增量输出交给模型解释。 */
export async function runLongCommandMonitor(
  options: RunLongCommandMonitorOptions,
): Promise<AiCommandResult> {
  if (options.signal.aborted) throw createAbortError();

  const startedAt = Date.now();
  const intervalMs = options.reportIntervalMs ?? LONG_COMMAND_REPORT_INTERVAL_MS;
  let stdoutDelta = "";
  let stderrDelta = "";

  const completion: Promise<CompletionEvent> = options.execute((stream, text) => {
    if (stream === "stdout") {
      stdoutDelta = appendTail(stdoutDelta, text, 6_000);
    } else {
      stderrDelta = appendTail(stderrDelta, text, 4_000);
    }
  }).then(
    result => ({ type: "completed", result }),
    error => ({ type: "failed", error }),
  );

  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = new Promise<{ type: "interval" }>(resolve => {
      timer = setTimeout(() => resolve({ type: "interval" }), intervalMs);
    });
    const event = await Promise.race([completion, interval]);
    if (timer) clearTimeout(timer);

    if (event.type === "completed") return event.result;
    if (event.type === "failed") throw event.error;
    if (options.signal.aborted) throw createAbortError();

    const progress: AiLongCommandProgressContext = {
      toolCallId: options.toolCallId,
      command: options.command,
      reason: options.reason,
      risk: options.risk,
      elapsedMs: Date.now() - startedAt,
      stdoutDelta,
      stderrDelta,
      outputChanged: Boolean(stdoutDelta || stderrDelta),
    };
    stdoutDelta = "";
    stderrDelta = "";

    // 模型生成进度期间命令可能已经结束；终态优先，过时进度不再写入对话。
    const progressController = new AbortController();
    const progressSignal = AbortSignal.any([
      options.signal,
      progressController.signal,
    ]);
    const progressReport = options.onProgress(progress, progressSignal).then(
      () => ({ type: "reported" as const }),
      error => ({ type: "report_failed" as const, error }),
    );
    const progressEvent = await Promise.race([completion, progressReport]);
    if (progressEvent.type === "completed") {
      progressController.abort();
      return progressEvent.result;
    }
    if (progressEvent.type === "failed") {
      progressController.abort();
      throw progressEvent.error;
    }
    if (progressEvent.type === "report_failed" && options.signal.aborted) {
      throw createAbortError();
    }
    // 单次模型进度说明失败不应中止正在运行的 Shell，下个周期继续尝试。
  }
}
