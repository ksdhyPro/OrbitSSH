const retryableAiStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504]);
const retryableAiNetworkErrorCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_REQ_ABORTED",
]);

export const maxAiResponseAttempts = 3;
const aiRetryBaseDelayMs = 500;
const aiRetryMaxDelayMs = 4_000;

export function isRetryableAiStatus(status: number): boolean {
  return retryableAiStatusCodes.has(status);
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  return getErrorCode(record.cause);
}

export function isRetryableAiNetworkError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (retryableAiNetworkErrorCodes.has(code)) return true;

  if (!(error instanceof TypeError)) return false;
  return /fetch failed|network|socket|connection|timed? ?out|premature/i.test(
    error.message,
  );
}

export function getAiRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    aiRetryBaseDelayMs * 2 ** (normalizedAttempt - 1),
    aiRetryMaxDelayMs,
  );
}

/** Wait for the next retry without delaying cancellation. */
export function waitForAiRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (shouldRetry: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(shouldRetry);
    };
    const onAbort = () => finish(false);

    timer = setTimeout(() => finish(true), Math.max(0, delayMs));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
