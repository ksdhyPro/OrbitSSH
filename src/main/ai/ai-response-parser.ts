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
    const args = parseToolArguments(toolCall.function.arguments);
    const message = args && typeof args === "object"
      ? (args as Record<string, unknown>).message
      : undefined;
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

function extractCommandFromLooseJson(text: string): string {
  const match = text.match(
    /["'](?:command|cmd|shell|script|commandLine|command_line)["']\s*:\s*["']([^"']+)["']/,
  );
  return match?.[1]?.trim() ?? "";
}

function parseToolArguments(rawArgs: unknown): unknown {
  if (rawArgs && typeof rawArgs === "object") return rawArgs;
  if (typeof rawArgs !== "string") return {};
  let parsed: unknown = rawArgs;
  for (let depth = 0; depth < 2 && typeof parsed === "string"; depth += 1) {
    const text = parsed.trim();
    if (!text) return {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return { command: extractCommandFromLooseJson(text) };
    }
  }
  return parsed;
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
  const args = parseToolArguments(rawArgs);
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  const fallbackReason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : "执行命令";
  if (Array.isArray(record.commands)) {
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
      .filter((item): item is ParsedAiCommand => item !== null)
      .slice(0, 1);
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
    const args = parseToolArguments(toolCall.function.arguments);
    if (!args || typeof args !== "object") return [];
    const message = (args as Record<string, unknown>).message;
    return typeof message === "string" && message.trim()
      ? [{ message: message.trim() }]
      : [];
  });
}

export function parseSavedServerToolCalls(rawToolCalls: RawToolCall[]): ParsedAiSavedServerCommand[] {
  return rawToolCalls.flatMap(toolCall => {
    if (toolCall.type !== 'function' || toolCall.function?.name !== 'run_saved_server_command') return []
    const args = parseToolArguments(toolCall.function.arguments)
    if (!args || typeof args !== 'object') return []
    const record = args as Record<string, unknown>
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
): Promise<{
  contentText: string;
  toolCalls: StreamedToolCall[];
  rawResponseText: string;
  usage?: AiTokenUsage;
}> {
  if (!body) return { contentText: "", toolCalls: [], rawResponseText: "" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let contentText = "";
  let usage: AiTokenUsage | undefined;
  const toolCallsByIndex = new Map<number, StreamedToolCall>();

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
  };

  const consumeSseLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trimStart();
    if (!data || data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
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
    };
  }

  let fallbackContent = "";
  const fallbackToolCalls: StreamedToolCall[] = [];
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
    // 回退解析失败时保持空结果，由上层生成可读提示。
  }
  if (fallbackContent) sendChunk?.(fallbackContent);
  return {
    contentText: fallbackContent,
    toolCalls: fallbackToolCalls,
    rawResponseText: rawText,
    usage,
  };
}
