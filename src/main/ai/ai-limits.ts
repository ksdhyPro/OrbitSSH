/** 单次用户请求最多执行的命令数，避免失控循环和不可预期费用。 */
export const MAX_AI_COMMANDS_PER_TURN = 12;

/** 单次用户请求的总运行时长上限。 */
export const MAX_AI_TURN_ELAPSED_MS = 10 * 60 * 1000;

/** 单次模型请求的超时上限，防止提供商长时间无响应。 */
export const MAX_AI_PROVIDER_REQUEST_MS = 60_000;
