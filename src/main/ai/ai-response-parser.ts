import { randomUUID } from "node:crypto";
import type { AiTokenUsage } from "./ai-context-budget.js";

export interface ParsedAssistantResponse {
  reply?: string;
  commands?: ParsedAiCommand[];
  longCommands?: ParsedAiCommand[];
  progressReports?: ParsedAiProgressReport[];
  savedServerCommands?: ParsedAiSavedServerCommand[];
  /** 仅 finish_response 可以明确标记模型已完成当前用户目标。 */
  completed?: boolean;
  /** 模型未返回合法动作时用于触发带纠正提示的重试。 */
  protocolError?: boolean;
  usage?: AiTokenUsage;
  contextLimitExceeded?: boolean;
}

export interface ParsedAiCommand {
  toolCallId: string;
  command: string;
  reason: string;
  risk: "low" | "medium" | "high";
}

export interface ParsedAiSavedServerCommand extends ParsedAiCommand {
  serverName: string;
}

export interface ParsedAiProgressReport {
  message: string;
}

export interface StreamedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type RawToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

export interface EvaluatedAssistantTurnProtocol {
  outcome: "tool_call" | "finish" | "protocol_error";
  retryable: boolean;
  finalReply?: string;
  /** 协议重试耗尽后可直接展示的模型原始正文。 */
  fallbackReply?: string;
}

export type AssistantTurnPhase = "normal" | "long_command_running";

/**
 * 判断模型单轮是否遵守 Agent 动作协议。
 * 纯文本不能隐式代表完成，避免“准备检查”之类的占位回复提前终止流程。
 */
export function evaluateAssistantTurnProtocol(
  reply: string,
  rawToolCalls: RawToolCall[],
  phase: AssistantTurnPhase = "normal",
): EvaluatedAssistantTurnProtocol {
  if (rawToolCalls.length !== 1) {
    return {
      outcome: "protocol_error",
      retryable: true,
      fallbackReply: rawToolCalls.length === 0
        ? reply.trim()
        : undefined,
    };
  }

  const toolCall = rawToolCalls[0]!;
  if (
    phase === "long_command_running" &&
    toolCall.type === "function" &&
    toolCall.function?.name === "report_long_command_progress"
  ) {
    const reports = parseLongCommandProgressToolCalls(rawToolCalls);
    return reports.length === 1
      ? { outcome: "tool_call", retryable: false }
      : { outcome: "protocol_error", retryable: true };
  }

  // 长命令运行期间只能汇报进度，不能提前结束或启动其他命令。
  if (phase === "long_command_running") {
    return { outcome: "protocol_error", retryable: true };
  }

  if (
    toolCall.type === "function" &&
    toolCall.function?.name === "finish_response"
  ) {
    const message = parseToolArguments(toolCall.function.arguments)?.message;
    if (typeof message === "string" && message.trim()) {
      return {
        outcome: "finish",
        retryable: false,
        finalReply: message.trim(),
      };
    }
    return { outcome: "protocol_error", retryable: true };
  }

  const commandCount =
    parseRunShellToolCalls(rawToolCalls).length +
    parseRunLongShellToolCalls(rawToolCalls).length +
    parseSavedServerToolCalls(rawToolCalls).length;
  return commandCount === 1
    ? { outcome: "tool_call", retryable: false }
    : { outcome: "protocol_error", retryable: true };
}

const maxSseResponseChars = 2_000_000;

export interface StreamCollectorOptions {
  /** finish_response 的 message 参数在流式过程中逐步解码出的完整文本。 */
  onFinishPreview?: (text: string) => void;
  /** 每收到一块数据时调用，用于重置空闲超时。 */
  onActivity?: () => void;
}

const jsonEscapes: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

/**
 * 从尚未接收完整的 JSON 文本中解码某个字符串字段的当前内容。
 * 遇到不完整的转义序列时停在其之前，避免界面短暂显示半个字符或转义符。
 */
export function extractPartialJsonStringField(json: string, field: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!match) return undefined;

  let result = "";
  let index = match.index + match[0].length;
  while (index < json.length) {
    const char = json[index]!;
    if (char === '"') return result;
    if (char !== "\\") {
      result += char;
      index += 1;
      continue;
    }

    const next = json[index + 1];
    if (next === undefined) break;
    if (next !== "u") {
      result += jsonEscapes[next] ?? next;
      index += 2;
      continue;
    }

    const code = Number.parseInt(json.slice(index + 2, index + 6), 16);
    if (json.length < index + 6 || Number.isNaN(code)) break;
    if (code >= 0xd800 && code <= 0xdbff) {
      // 代理对需要两个 \uXXXX 都到达后再一起解码。
      const low = Number.parseInt(json.slice(index + 8, index + 12), 16);
      if (json.length < index + 12 || json.slice(index + 6, index + 8) !== "\\u" || Number.isNaN(low)) break;
      result += String.fromCharCode(code, low);
      index += 12;
      continue;
    }
    result += String.fromCharCode(code);
    index += 6;
  }
  return result;
}

/** 为每个流式工具调用跟踪 finish_response 预览，仅在内容变化时回调。 */
export function createFinishPreviewTracker(onFinishPreview?: (text: string) => void) {
  let lastPreview = "";
  return (name: string, args: string): void => {
    if (!onFinishPreview || name !== "finish_response") return;
    const preview = extractPartialJsonStringField(args, "message");
    if (preview === undefined || preview === lastPreview) return;
    lastPreview = preview;
    onFinishPreview(preview);
  };
}

export function parseAiTokenUsage(value: unknown): AiTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
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

function normalizeAiCommandRisk(value: unknown): ParsedAiCommand["risk"] {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : "medium";
}

/**
 * 解析工具参数；兼容参数被二次 JSON 编码的接口。
 * 参数不是合法 JSON 时返回 null 交由协议重试，绝不从残缺文本中猜测命令，
 * 避免截断的命令（例如引号处被截掉的删除命令）被执行。
 */
function parseToolArguments(rawArgs: unknown): Record<string, unknown> | null {
  let parsed: unknown = rawArgs;
  for (let depth = 0; depth < 2 && typeof parsed === "string"; depth += 1) {
    const text = parsed.trim();
    if (!text) return null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function createCommandFromRecord(
  record: Record<string, unknown>,
  fallbackReason = "执行命令",
  toolCallId = `orbitssh-call-${randomUUID()}`,
): ParsedAiCommand | null {
  const commandKeys = ["command", "cmd", "shell", "script", "commandLine", "command_line"];
  const command = commandKeys
    .map(key => record[key])
    .find((value): value is string => typeof value === "string")
    ?.trim();
  if (!command) return null;
  return {
    toolCallId,
    command,
    reason:
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason.trim()
        : fallbackReason,
    risk: normalizeAiCommandRisk(record.risk),
  };
}

function buildCommandsFromToolArguments(
  rawArgs: unknown,
  toolCallId: string,
): ParsedAiCommand[] {
  const record = parseToolArguments(rawArgs);
  if (!record) return [];
  const fallbackReason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : "执行命令";
  if (Array.isArray(record.commands)) {
    // 每次工具调用只能执行一条命令；一次给出多条时整体视为无效，不静默丢弃其余命令。
    if (record.commands.length !== 1) return [];
    return record.commands
      .map(item =>
        typeof item === "string"
          ? createCommandFromRecord(
              { command: item, reason: fallbackReason, risk: record.risk },
              fallbackReason,
              toolCallId,
            )
          : item && typeof item === "object"
            ? createCommandFromRecord(
                item as Record<string, unknown>,
                fallbackReason,
                toolCallId,
              )
            : null,
      )
      .filter((item): item is ParsedAiCommand => item !== null);
  }
  const command = createCommandFromRecord(record, fallbackReason, toolCallId);
  return command ? [command] : [];
}

export function parseRunShellToolCalls(rawToolCalls: RawToolCall[]): ParsedAiCommand[] {
  return rawToolCalls.flatMap(toolCall =>
    toolCall.type !== "function" || toolCall.function?.name !== "run_shell_command"
      ? []
      : buildCommandsFromToolArguments(
          toolCall.function.arguments,
          toolCall.id || `orbitssh-call-${randomUUID()}`,
        ),
  );
}

export function parseRunLongShellToolCalls(
  rawToolCalls: RawToolCall[],
): ParsedAiCommand[] {
  return rawToolCalls.flatMap(toolCall =>
    toolCall.type !== "function" ||
    toolCall.function?.name !== "run_long_shell_command"
      ? []
      : buildCommandsFromToolArguments(
          toolCall.function.arguments,
          toolCall.id || `orbitssh-call-${randomUUID()}`,
        ),
  );
}

export function parseLongCommandProgressToolCalls(
  rawToolCalls: RawToolCall[],
): ParsedAiProgressReport[] {
  return rawToolCalls.flatMap(toolCall => {
    if (
      toolCall.type !== "function" ||
      toolCall.function?.name !== "report_long_command_progress"
    ) {
      return [];
    }
    const message = parseToolArguments(toolCall.function.arguments)?.message;
    return typeof message === "string" && message.trim()
      ? [{ message: message.trim() }]
      : [];
  });
}

export function parseSavedServerToolCalls(rawToolCalls: RawToolCall[]): ParsedAiSavedServerCommand[] {
  return rawToolCalls.flatMap(toolCall => {
    if (toolCall.type !== 'function' || toolCall.function?.name !== 'run_saved_server_command') return []
    const record = parseToolArguments(toolCall.function.arguments)
    if (!record) return []
    const command = createCommandFromRecord(
      record,
      '在已保存服务器执行命令',
      toolCall.id || `orbitssh-call-${randomUUID()}`,
    )
    const serverName = typeof record.serverName === 'string' ? record.serverName.trim() : ''
    return command && serverName ? [{ ...command, serverName }] : []
  })
}

export async function collectSseStream(
  body: ReadableStream<Uint8Array> | null,
  sendChunk?: (text: string) => void,
  options: StreamCollectorOptions = {},
): Promise<{
  contentText: string;
  toolCalls: StreamedToolCall[];
  rawResponseText: string;
  usage?: AiTokenUsage;
  /** 响应既不是 SSE 也不是 JSON（例如网关返回的 HTML 页面）。 */
  unparsable?: boolean;
}> {
  if (!body) return { contentText: "", toolCalls: [], rawResponseText: "" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let contentText = "";
  let usage: AiTokenUsage | undefined;
  let validEvents = 0;
  const toolCallsByIndex = new Map<number, StreamedToolCall>();
  const trackFinishPreview = createFinishPreviewTracker(options.onFinishPreview);

  const appendToolCallDelta = (
    index: number,
    id: unknown,
    name: unknown,
    args: unknown,
  ): void => {
    const existing = toolCallsByIndex.get(index) ?? { id: "", name: "", arguments: "" };
    if (typeof id === "string" && id) existing.id = id;
    if (typeof name === "string" && name) existing.name = name;
    if (typeof args === "string" && args) existing.arguments += args;
    toolCallsByIndex.set(index, existing);
    if (index === 0) trackFinishPreview(existing.name, existing.arguments);
  };

  const consumeSseLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trimStart();
    if (!data || data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      validEvents += 1;
      usage = parseAiTokenUsage(parsed?.usage) ?? usage;
      const packet = parsed?.choices?.[0]?.delta ?? parsed?.choices?.[0]?.message;
      if (!packet) return;
      if (typeof packet.content === "string" && packet.content) {
        contentText += packet.content;
        sendChunk?.(packet.content);
      }
      if (Array.isArray(packet.tool_calls)) {
        for (const toolCall of packet.tool_calls) {
          appendToolCallDelta(
            typeof toolCall.index === "number" ? toolCall.index : 0,
            toolCall.id,
            toolCall.function?.name,
            toolCall.function?.arguments,
          );
        }
      }
      if (packet.function_call) {
        appendToolCallDelta(0, "", packet.function_call.name, packet.function_call.arguments);
      }
    } catch {
      // 单个分片损坏时跳过，后续分片仍可继续接收。
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      options.onActivity?.();
      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      if (rawText.length > maxSseResponseChars) {
        await reader.cancel("AI response too large").catch(() => undefined);
        throw new Error("AI_RESPONSE_TOO_LARGE");
      }
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeSseLine);
    }
    const finalChunk = decoder.decode();
    rawText += finalChunk;
    buffer += finalChunk;
    if (buffer.trim()) consumeSseLine(buffer);
  } finally {
    reader.releaseLock();
  }

  const streamedToolCalls = Array.from(toolCallsByIndex.values()).filter(
    toolCall => toolCall.name && toolCall.arguments,
  );
  if (contentText || streamedToolCalls.length > 0) {
    return {
      contentText,
      toolCalls: streamedToolCalls,
      rawResponseText: rawText,
      usage,
      unparsable: false,
    };
  }

  let fallbackContent = "";
  const fallbackToolCalls: StreamedToolCall[] = [];
  let unparsable = false;
  try {
    const payload = JSON.parse(rawText) as Record<string, unknown>;
    usage = parseAiTokenUsage(payload.usage) ?? usage;
    const choice = (payload.choices as Array<Record<string, unknown>>)?.[0];
    const message = (choice?.message ?? {}) as Record<string, unknown>;
    fallbackContent = typeof message.content === "string" ? message.content.trim() : "";
    for (const toolCall of (message.tool_calls as Array<Record<string, unknown>>) ?? []) {
      const fn = toolCall.function as Record<string, unknown> | undefined;
      if (typeof fn?.name === "string" && typeof fn.arguments === "string") {
        fallbackToolCalls.push({
          id: typeof toolCall.id === "string" ? toolCall.id : "",
          name: fn.name,
          arguments: fn.arguments,
        });
      }
    }
    const legacy = message.function_call as Record<string, unknown> | undefined;
    if (typeof legacy?.name === "string" && typeof legacy.arguments === "string") {
      fallbackToolCalls.push({
        id: "",
        name: legacy.name,
        arguments: legacy.arguments,
      });
    }
  } catch {
    // 回退解析失败时保持空结果；完全没有有效事件说明响应不是模型接口返回的。
    unparsable = validEvents === 0 && Boolean(rawText.trim());
  }
  if (fallbackContent) sendChunk?.(fallbackContent);
  return {
    contentText: fallbackContent,
    toolCalls: fallbackToolCalls,
    rawResponseText: rawText,
    usage,
    unparsable,
  };
}
