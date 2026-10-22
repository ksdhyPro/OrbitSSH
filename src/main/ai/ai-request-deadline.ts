export type AiTimeoutReason = "first_byte" | "idle" | "total";

export interface AiRequestDeadlineOptions {
  /** 发出请求到收到响应头的最长等待。非流式请求要等模型生成完整答复，应设置得更长。 */
  firstByteMs: number;
  /** 流式响应两次数据之间的最长间隔。推理模型输出思考内容时也会持续产生数据。 */
  idleMs: number;
  /** 单次请求的绝对上限。 */
  totalMs: number;
}

export class AiRequestTimeoutError extends Error {
  constructor(readonly reason: AiTimeoutReason) {
    super(`AI request timed out: ${reason}`);
    this.name = "TimeoutError";
  }
}

/**
 * 用首字节、空闲和总时长三个计时器替代单一总超时：
 * 长回答只要持续输出就不会被打断，服务卡住不动时能及时停止等待。
 */
export function createRequestDeadline(options: AiRequestDeadlineOptions) {
  const controller = new AbortController();
  let reason: AiTimeoutReason | undefined;
  let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;

  const expire = (timeoutReason: AiTimeoutReason) => {
    if (controller.signal.aborted) return;
    reason = timeoutReason;
    dispose();
    controller.abort(new AiRequestTimeoutError(timeoutReason));
  };
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => expire("idle"), options.idleMs);
  };
  const dispose = () => {
    if (firstByteTimer) clearTimeout(firstByteTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (totalTimer) clearTimeout(totalTimer);
    firstByteTimer = idleTimer = totalTimer = undefined;
  };

  firstByteTimer = setTimeout(() => expire("first_byte"), options.firstByteMs);
  totalTimer = setTimeout(() => expire("total"), options.totalMs);

  return {
    signal: controller.signal,
    /** 收到响应头后改为按空闲间隔计时。 */
    markResponseStarted(): void {
      if (controller.signal.aborted) return;
      if (firstByteTimer) clearTimeout(firstByteTimer);
      firstByteTimer = undefined;
      resetIdle();
    },
    /** 每收到一块数据调用一次，重置空闲计时。 */
    markActivity(): void {
      if (controller.signal.aborted || firstByteTimer) return;
      resetIdle();
    },
    get reason(): AiTimeoutReason | undefined {
      return reason;
    },
    dispose,
  };
}

export type AiRequestDeadline = ReturnType<typeof createRequestDeadline>;
