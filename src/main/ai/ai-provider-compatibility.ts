export type AiCompatibilityFallbackParameter = "tool_choice" | "stream_options";

export interface AiCompatibilityRequestResult {
  response: Response;
  responseText: string;
}

type AiFetch = typeof fetch;

function isUnsupportedParameterError(
  status: number,
  responseText: string,
  parameterPattern: RegExp,
): boolean {
  if (status !== 400 && status !== 422) return false;
  // 只检查错误说明及参数名，避免请求回显中的同名字段造成误回退。
  let errorText = responseText;
  try {
    const payload = JSON.parse(responseText);
    const error = payload?.error ?? payload;
    errorText =
      typeof error === "string"
        ? error
        : [error?.message, error?.param].filter(value => typeof value === "string").join(" ");
  } catch {
    // 部分兼容网关直接返回纯文本错误，继续按原说明判断。
  }
  if (!parameterPattern.test(errorText)) return false;

  // DeepSeek 思考模式使用 does not support，而不是 not supported。
  return /(?:not\s+supported|(?:does\s+not|do\s+not|doesn't|don't)\s+support|unsupported|unknown\s+parameter|unrecognized|unexpected|invalid\s+(?:parameter|value)|extra\s+inputs?|not\s+permitted|not\s+allowed)/i.test(
    errorText,
  );
}

export function isToolChoiceUnsupported(status: number, responseText: string): boolean {
  return isUnsupportedParameterError(status, responseText, /\btool[_ -]?choice\b/i);
}

function isStreamOptionsUnsupported(status: number, responseText: string): boolean {
  return isUnsupportedParameterError(
    status,
    responseText,
    /\b(?:stream[_ -]?options|include[_ -]?usage)\b/i,
  );
}

/**
 * 优先携带标准 AI 请求参数；兼容接口明确拒绝参数时，逐项移除后重试。
 * 请求体会同步删除不兼容参数，确保 Token 估算使用最终实际发送内容。
 */
export async function requestAiJsonWithCompatibilityFallback(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  allowStreamOptionsFallback: boolean,
  fetcher: AiFetch = fetch,
  onFallback?: (parameter: AiCompatibilityFallbackParameter) => void,
): Promise<AiCompatibilityRequestResult> {
  // 最多发送初始请求，加两个兼容参数各回退一次。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (response.ok) return { response, responseText: "" };

    const responseText = await response.text().catch(() => "");
    if (
      Object.hasOwn(body, "tool_choice") &&
      isToolChoiceUnsupported(response.status, responseText)
    ) {
      delete body.tool_choice;
      onFallback?.("tool_choice");
      continue;
    }
    if (
      allowStreamOptionsFallback &&
      Object.hasOwn(body, "stream_options") &&
      isStreamOptionsUnsupported(response.status, responseText)
    ) {
      delete body.stream_options;
      onFallback?.("stream_options");
      continue;
    }
    return { response, responseText };
  }

  throw new Error("AI_COMPATIBILITY_FALLBACK_EXHAUSTED");
}
