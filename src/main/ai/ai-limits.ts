/** 单次用户请求最多执行的命令数，避免失控循环和不可预期费用。 */
export const MAX_AI_COMMANDS_PER_TURN = 20;

/** 单次用户请求的总运行时长上限。 */
export const MAX_AI_TURN_ELAPSED_MS = 10 * 60 * 1000;

/** 流式请求等待响应头的上限。 */
export const AI_STREAM_FIRST_BYTE_TIMEOUT_MS = 60_000;

/** 流式输出两次数据之间的最长间隔，持续输出的长回答不会被打断。 */
export const AI_STREAM_IDLE_TIMEOUT_MS = 60_000;

/** 非流式请求需要等模型生成完整答复后才返回响应头，等待时间更长。 */
export const AI_NON_STREAM_RESPONSE_TIMEOUT_MS = 180_000;

/** 单次模型请求的绝对上限。 */
export const AI_REQUEST_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
