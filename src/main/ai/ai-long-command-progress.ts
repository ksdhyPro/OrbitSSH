import type { AiMessage } from "../../shared/ai.js";
import type { AgentEmitter } from "./ai-agent-events.js";
import type { AiLongCommandProgressContext } from "./ai-context.js";

export const LONG_COMMAND_OUTPUT_FALLBACK = "长命令仍在执行，已收到新的运行输出。";
export const LONG_COMMAND_IDLE_MESSAGE = "长命令仍在执行中，最近一个汇报周期没有新增输出。";

export function formatLongCommandElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export interface LongCommandProgressReporterOptions {
  messages: AiMessage[];
  emit?: AgentEmitter;
  /** 请求模型把新增输出概括为一句进度；返回空值时使用本地兜底文案。 */
  requestProgressMessage: (
    progress: AiLongCommandProgressContext,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
  createMessage: (content: string) => AiMessage;
}

/**
 * 为单条长命令维护一条原地更新的进度消息：
 * 有新增输出时才请求模型概括，没有新输出时直接在本地更新已运行时长，不消耗模型调用。
 */
export function createLongCommandProgressReporter(options: LongCommandProgressReporterOptions) {
  let progressMessage: AiMessage | null = null;

  return async (progress: AiLongCommandProgressContext, signal: AbortSignal): Promise<void> => {
    const summary = progress.outputChanged
      ? (await options.requestProgressMessage(progress, signal)) || LONG_COMMAND_OUTPUT_FALLBACK
      : LONG_COMMAND_IDLE_MESSAGE;
    if (signal.aborted) return;

    const content = `${summary}\n\n已运行 ${formatLongCommandElapsed(progress.elapsedMs)}`;
    if (!progressMessage) {
      progressMessage = options.createMessage(content);
      options.messages.push(progressMessage);
      options.emit?.sendMessageStart(progressMessage.id, progressMessage.createdAt);
      options.emit?.sendChunk(progressMessage.id, content);
      return;
    }

    // 消息对象已在本轮结果中，直接修改即可让最终结果与界面保持一致。
    progressMessage.content = content;
    options.emit?.replaceMessage(progressMessage.id, content);
  };
}
