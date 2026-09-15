import type { AiProviderMessage } from "./ai-context.js";
import type { AiTokenUsage } from "./ai-context-budget.js";
import type { RawToolCall, StreamedToolCall } from "./ai-response-parser.js";

interface ParsedResponsesResult {
  contentText: string;
  toolCalls: RawToolCall[];
  usage?: AiTokenUsage;
  error?: string;
}

interface StreamedResponsesResult extends ParsedResponsesResult {
  toolCalls: StreamedToolCall[];
  rawResponseText: string;
}

const maxSseResponseChars = 2_000_000;

export function parseResponsesTokenUsage(value: unknown): AiTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = Number(usage.input_tokens);
  const completionTokens = Number(usage.output_tokens);
  const totalTokens = Number(usage.total_tokens);
  if (
    !Number.isFinite(promptTokens) ||
    !Number.isFinite(completionTokens) ||
    !Number.isFinite(totalTokens)
  ) return undefined;

  return {
    promptTokens: Math.max(0, Math.trunc(promptTokens)),
    completionTokens: Math.max(0, Math.trunc(completionTokens)),
    totalTokens: Math.max(0, Math.trunc(totalTokens)),
    source: "provider",
  };
}

/** 把现有 Chat Completions 消息转换为 Responses API 的输入项。 */
export function buildResponsesInput(messages: AiProviderMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.tool_calls?.length) {
      if (message.content.trim()) {
        input.push({ role: "assistant", content: message.content });
      }
      for (const toolCall of message.tool_calls) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });
      }
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      });
      continue;
    }
    input.push({ role: message.role, content: message.content });
  }
  return input;
}

/** Responses API 的 function tool 字段位于顶层，不使用 Chat 的 function 包装层。 */
export function buildResponsesTools(tools: ReadonlyArray<Record<string, unknown>>): unknown[] {
  return tools.flatMap(tool => {
    const fn = tool.function;
    if (tool.type !== "function" || !fn || typeof fn !== "object") return [];
    const record = fn as Record<string, unknown>;
    return [{
      type: "function",
      name: record.name,
      description: record.description,
      parameters: record.parameters,
      strict: record.strict,
    }];
  });
}

function getResponseError(payload: Record<string, unknown>): string | undefined {
  const error = payload.error;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

export function parseResponsesPayload(value: unknown): ParsedResponsesResult {
  if (!value || typeof value !== "object") {
    return { contentText: "", toolCalls: [] };
  }
  const payload = value as Record<string, unknown>;
  const textParts: string[] = [];
  const toolCalls: RawToolCall[] = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== "object") continue;
    const outputItem = item as Record<string, unknown>;
    if (outputItem.type === "message") {
      for (const part of Array.isArray(outputItem.content) ? outputItem.content : []) {
        if (!part || typeof part !== "object") continue;
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string" && text) textParts.push(text);
      }
    } else if (
      outputItem.type === "function_call" &&
      typeof outputItem.name === "string"
    ) {
      toolCalls.push({
        id: typeof outputItem.call_id === "string"
          ? outputItem.call_id
          : typeof outputItem.id === "string" ? outputItem.id : undefined,
        type: "function",
        function: {
          name: outputItem.name,
          arguments: typeof outputItem.arguments === "string"
            ? outputItem.arguments
            : "",
        },
      });
    }
  }
  return {
    contentText: textParts.join(""),
    toolCalls,
    usage: parseResponsesTokenUsage(payload.usage),
    error: getResponseError(payload),
  };
}

/** 仅对明确不支持 Responses 的响应降级，认证、限流和服务异常保持原错误。 */
export function isResponsesApiUnsupported(status: number, responseText: string): boolean {
  if (status === 404 || status === 405 || status === 501) return true;
  if (status !== 400 && status !== 422) return false;
  return /(?:responses? api|\/responses).*(?:not supported|unsupported|not found|unknown)|(?:not supported|unsupported|unknown (?:url|endpoint|path)).*(?:responses? api|\/responses)/i.test(
    responseText,
  );
}

export async function collectResponsesSseStream(
  body: ReadableStream<Uint8Array> | null,
  sendChunk?: (text: string) => void,
): Promise<StreamedResponsesResult> {
  if (!body) {
    return { contentText: "", toolCalls: [], rawResponseText: "" };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCallsByIndex = new Map<number, StreamedToolCall>();
  let buffer = "";
  let rawResponseText = "";
  let contentText = "";
  let usage: AiTokenUsage | undefined;
  let responseError: string | undefined;

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trimStart();
    if (!data || data === "[DONE]") return;
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      const type = event.type;
      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        contentText += event.delta;
        sendChunk?.(event.delta);
      } else if (type === "response.output_item.added") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") {
          toolCallsByIndex.set(Number(event.output_index) || 0, {
            id: typeof item.call_id === "string" ? item.call_id : "",
            name: typeof item.name === "string" ? item.name : "",
            arguments: typeof item.arguments === "string" ? item.arguments : "",
          });
        }
      } else if (type === "response.function_call_arguments.delta") {
        const index = Number(event.output_index) || 0;
        const toolCall = toolCallsByIndex.get(index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (typeof event.delta === "string") toolCall.arguments += event.delta;
        toolCallsByIndex.set(index, toolCall);
      } else if (type === "response.output_item.done") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") {
          toolCallsByIndex.set(Number(event.output_index) || 0, {
            id: typeof item.call_id === "string" ? item.call_id : "",
            name: typeof item.name === "string" ? item.name : "",
            arguments: typeof item.arguments === "string" ? item.arguments : "",
          });
        }
      } else if (type === "response.completed" || type === "response.failed") {
        const response = event.response as Record<string, unknown> | undefined;
        usage = parseResponsesTokenUsage(response?.usage) ?? usage;
        responseError = response ? getResponseError(response) ?? responseError : responseError;
      }
    } catch {
      // 单个 SSE 事件损坏时跳过，继续接收后续事件。
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawResponseText += chunk;
      if (rawResponseText.length > maxSseResponseChars) {
        await reader.cancel("AI response too large").catch(() => undefined);
        throw new Error("AI_RESPONSE_TOO_LARGE");
      }
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
    }
    const finalChunk = decoder.decode();
    rawResponseText += finalChunk;
    buffer += finalChunk;
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!contentText && toolCallsByIndex.size === 0 && rawResponseText.trim()) {
    try {
      // 少数兼容服务即使请求 stream=true 仍直接返回 JSON，继续兼容该行为。
      const parsed = parseResponsesPayload(JSON.parse(rawResponseText));
      contentText = parsed.contentText;
      usage = parsed.usage ?? usage;
      responseError = parsed.error ?? responseError;
      parsed.toolCalls.forEach((toolCall, index) => {
        toolCallsByIndex.set(index, {
          id: toolCall.id ?? "",
          name: toolCall.function?.name ?? "",
          arguments: typeof toolCall.function?.arguments === "string"
            ? toolCall.function.arguments
            : "",
        });
      });
      if (contentText) sendChunk?.(contentText);
    } catch {
      // 非 JSON 内容保持空结果，由上层统一处理。
    }
  }

  return {
    contentText,
    toolCalls: Array.from(toolCallsByIndex.values()).filter(
      toolCall => toolCall.name && toolCall.arguments,
    ),
    rawResponseText,
    usage,
    error: responseError,
  };
}
