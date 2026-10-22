import { redactSensitiveTerminalText, truncateText } from "./ai-context.js";
import { isContextWindowExceededError } from "./ai-context-budget.js";
import type { AiTimeoutReason } from "./ai-request-deadline.js";

export interface AiRequestFailure {
  /** 直接展示给用户的中文说明。 */
  message: string;
  retryable: boolean;
  /** 服务端通过 Retry-After 要求的等待时间。 */
  retryAfterMs?: number;
  contextLimitExceeded?: boolean;
}

const MAX_RETRY_AFTER_MS = 30_000;

/** 解析 Retry-After 头：既可能是秒数，也可能是 HTTP 日期。 */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(delay) || delay < 0) return undefined;
  return Math.min(delay, MAX_RETRY_AFTER_MS);
}

/** 从 OpenAI 兼容错误体中提取服务端说明，脱敏并截断后用于提示用户。 */
export function extractProviderErrorMessage(responseText: string): string {
  let message = "";
  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const error = payload.error;
    if (error && typeof error === "object") {
      const errorMessage = (error as Record<string, unknown>).message;
      if (typeof errorMessage === "string") message = errorMessage;
    } else if (typeof error === "string") {
      message = error;
    } else if (typeof payload.message === "string") {
      message = payload.message;
    }
  } catch {
    // 非 JSON 错误页（例如网关 HTML）不展示原文，避免把整页内容塞进对话。
  }
  return truncateText(redactSensitiveTerminalText(message.trim()), 200);
}

function withProviderDetail(base: string, responseText: string): string {
  const detail = extractProviderErrorMessage(responseText);
  return detail ? `${base}\n\n服务端说明：${detail}` : base;
}

/** 根据 HTTP 状态码给出可操作的说明，并决定是否值得自动重试。 */
export function describeHttpFailure(
  status: number,
  responseText: string,
  retryAfterHeader?: string | null,
): AiRequestFailure {
  if (isContextWindowExceededError(status, responseText)) {
    return { message: "模型上下文窗口已达到上限。", retryable: false, contextLimitExceeded: true };
  }
  if (status === 401 || status === 403) {
    return {
      message: withProviderDetail(`AI 服务拒绝了请求（HTTP ${status}）：API Key 无效、已过期或没有该模型的权限。`, responseText),
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      message: withProviderDetail("AI 服务找不到接口或模型（HTTP 404）。请检查 Base URL（通常以 /v1 结尾）和模型名称。", responseText),
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      message: withProviderDetail("AI 服务请求过于频繁或额度不足（HTTP 429），请稍后重试或检查账户额度。", responseText),
      retryable: true,
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
    };
  }
  if (status === 408 || status >= 500) {
    return {
      message: withProviderDetail(`AI 服务暂时不可用（HTTP ${status}），请稍后重试。`, responseText),
      retryable: true,
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
    };
  }
  return {
    message: withProviderDetail(`AI 服务拒绝了请求参数（HTTP ${status}），请检查模型配置。`, responseText),
    retryable: false,
  };
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  return getErrorCode(record.cause);
}

const timeoutMessages: Record<AiTimeoutReason, string> = {
  first_byte: "AI 服务长时间没有响应，已停止等待。请检查网络、代理或稍后重试。",
  idle: "AI 服务输出中断超过 60 秒，已停止等待。请稍后重试。",
  total: "AI 服务单次响应时间过长，已停止等待。可以把问题拆小后重试。",
};

/** 把网络异常、超时和响应格式问题转换为具体的中文说明。 */
export function describeRequestError(
  error: unknown,
  timeoutReason?: AiTimeoutReason,
): AiRequestFailure {
  if (timeoutReason) {
    return { message: timeoutMessages[timeoutReason], retryable: true };
  }
  if (error instanceof Error && error.message === "AI_RESPONSE_TOO_LARGE") {
    return { message: "AI 服务响应过大，已停止接收。", retryable: false };
  }
  if (error instanceof AiProviderPayloadError) {
    return { message: `AI 服务返回错误：${truncateText(redactSensitiveTerminalText(error.message), 200)}`, retryable: true };
  }
  if (error instanceof SyntaxError) {
    return {
      message: "AI 服务返回的数据无法解析。请确认 Base URL 指向 OpenAI 兼容接口（通常以 /v1 结尾），而不是网页地址。",
      retryable: false,
    };
  }

  const code = getErrorCode(error);
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
    return { message: "无法连接 AI 服务：连接超时。请检查网络、代理或防火墙设置后重试。", retryable: true };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { message: "无法解析 AI 服务地址，请检查 Base URL 中的域名和网络 DNS。", retryable: code === "EAI_AGAIN" };
  }
  if (code === "ECONNREFUSED") {
    return { message: "AI 服务拒绝连接，请确认 Base URL 的地址和端口正确且服务已启动。", retryable: false };
  }
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return { message: "与 AI 服务的连接被中断，请稍后重试。", retryable: true };
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(code)) {
    return { message: "AI 服务的 TLS 证书校验失败，请检查 Base URL 是否正确或代理是否替换了证书。", retryable: false };
  }
  return { message: "无法连接 AI 服务。请检查网络、代理配置或稍后重试。", retryable: true };
}

/** 响应体或流式事件中携带的服务端错误。 */
export class AiProviderPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderPayloadError";
  }
}
