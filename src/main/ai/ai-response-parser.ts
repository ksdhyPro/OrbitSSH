import {
  AI_ATTACHMENT_CHUNK_MAX_BYTES,
  type AiAttachmentReadRequest,
} from '../../shared/ai.js'
import type { AiApiSpec } from '../../shared/settings.js'

export interface ParsedAssistantResponse {
  reply?: string;
  commands?: ParsedAiCommand[];
  attachmentReads?: ParsedAiAttachmentRead[];
}

export interface ParsedAiAttachmentRead extends AiAttachmentReadRequest {}

export interface ParsedAiCommand {
  command: string;
  reason: string;
  risk: "low" | "medium" | "high";
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

const maxSseResponseChars = 2_000_000;

export interface ParsedAiApiResponse {
  contentText: string;
  toolCalls: RawToolCall[];
}

function collectTextValues(values: unknown[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('')
}

export function parseAiApiResponsePayload(
  spec: AiApiSpec,
  payload: Record<string, unknown>,
): ParsedAiApiResponse {
  if (spec === 'anthropic') {
    const blocks = Array.isArray(payload.content) ? payload.content : [];
    const contentText = blocks.map(block => {
      if (!block || typeof block !== 'object') return '';
      const record = block as Record<string, unknown>;
      return collectTextValues([record.thinking, record.text]);
    }).join('').trim();
    const toolCalls: RawToolCall[] = blocks.flatMap(block => {
      if (!block || typeof block !== 'object') return [];
      const record = block as Record<string, unknown>;
      if (record.type !== 'tool_use' || typeof record.name !== 'string') return [];
      return [{
        id: typeof record.id === 'string' ? record.id : undefined,
        type: 'function',
        function: { name: record.name, arguments: record.input ?? {} },
      }];
    });
    return { contentText, toolCalls };
  }

  if (spec === 'responses') {
    const output = Array.isArray(payload.output) ? payload.output : [];
    const textParts: string[] = [];
    const toolCalls: RawToolCall[] = [];
    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (record.type === 'function_call' && typeof record.name === 'string') {
        toolCalls.push({
          id: typeof record.call_id === 'string'
            ? record.call_id
            : typeof record.id === 'string'
              ? record.id
              : undefined,
          type: 'function',
          function: { name: record.name, arguments: record.arguments ?? '' },
        });
        continue;
      }
      if (record.type === 'reasoning' && Array.isArray(record.summary)) {
        for (const summary of record.summary) {
          if (summary && typeof summary === 'object') {
            const text = (summary as Record<string, unknown>).text;
            if (typeof text === 'string') textParts.push(text);
          }
        }
      }
      if (Array.isArray(record.content)) {
        for (const content of record.content) {
          if (!content || typeof content !== 'object') continue;
          const contentRecord = content as Record<string, unknown>;
          const text = contentRecord.text;
          if (typeof text === 'string') textParts.push(text);
        }
      }
    }
    return { contentText: textParts.join('').trim(), toolCalls };
  }

  const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const contentText = collectTextValues([
    message.reasoning_content,
    message.reasoning,
    message.analysis_content,
    message.analysis,
    message.content,
  ]).trim();
  const toolCalls = ((message.tool_calls as RawToolCall[]) ?? []).slice();
  const legacy = message.function_call as Record<string, unknown> | undefined;
  if (typeof legacy?.name === 'string' && legacy.arguments !== undefined) {
    toolCalls.push({
      type: 'function',
      function: { name: legacy.name, arguments: legacy.arguments },
    });
  }
  return { contentText, toolCalls };
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
): ParsedAiCommand | null {
  const commandKeys = ["command", "cmd", "shell", "script", "commandLine", "command_line"];
  const command = commandKeys
    .map(key => record[key])
    .find((value): value is string => typeof value === "string")
    ?.trim();
  if (!command) return null;
  return {
    command,
    reason:
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason.trim()
        : fallbackReason,
    risk: normalizeAiCommandRisk(record.risk),
  };
}

function buildCommandsFromToolArguments(rawArgs: unknown): ParsedAiCommand[] {
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
          ? createCommandFromRecord({ command: item, reason: fallbackReason, risk: record.risk })
          : item && typeof item === "object"
            ? createCommandFromRecord(item as Record<string, unknown>, fallbackReason)
            : null,
      )
      .filter((item): item is ParsedAiCommand => item !== null);
  }
  const command = createCommandFromRecord(record, fallbackReason);
  return command ? [command] : [];
}

export function parseRunShellToolCalls(rawToolCalls: RawToolCall[]): ParsedAiCommand[] {
  return rawToolCalls.flatMap(toolCall =>
    toolCall.type !== "function" || toolCall.function?.name !== "run_shell_command"
      ? []
      : buildCommandsFromToolArguments(toolCall.function.arguments),
  );
}

export async function collectSseStream(
  body: ReadableStream<Uint8Array> | null,
  sendChunk?: (text: string) => void,
): Promise<{
  contentText: string;
  toolCalls: StreamedToolCall[];
  rawResponseText: string;
}> {
  if (!body) return { contentText: "", toolCalls: [], rawResponseText: "" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let contentText = "";
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
      const packet = parsed?.choices?.[0]?.delta ?? parsed?.choices?.[0]?.message;
      if (!packet) return;
      const textParts = [
        packet.reasoning_content,
        packet.reasoning,
        packet.analysis_content,
        packet.analysis,
        packet.content,
      ].filter((part): part is string => typeof part === "string" && part.length > 0);
      if (textParts.length > 0) {
        const text = textParts.join("");
        contentText += text;
        sendChunk?.(text);
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
    };
  }

  let fallbackContent = "";
  const fallbackToolCalls: StreamedToolCall[] = [];
  try {
    const payload = JSON.parse(rawText) as Record<string, unknown>;
    const choice = (payload.choices as Array<Record<string, unknown>>)?.[0];
    const message = (choice?.message ?? {}) as Record<string, unknown>;
    fallbackContent = [
      message.reasoning_content,
      message.reasoning,
      message.analysis_content,
      message.analysis,
      message.content,
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("")
      .trim();
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
  };
}

function createAttachmentReadFromRecord(
  record: Record<string, unknown>,
): ParsedAiAttachmentRead | null {
  const attachmentIdValue = record.attachment_id ?? record.attachmentId;
  const attachmentId =
    typeof attachmentIdValue === "string" ? attachmentIdValue.trim() : "";
  const offset = Number(record.offset);
  const maxBytes = Number(record.max_bytes ?? record.maxBytes);
  if (
    !attachmentId ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1
  ) {
    return null;
  }
  return {
    attachmentId,
    offset,
    maxBytes: Math.min(maxBytes, AI_ATTACHMENT_CHUNK_MAX_BYTES),
  };
}

export function parseAttachmentReadToolCalls(
  rawToolCalls: RawToolCall[],
): ParsedAiAttachmentRead[] {
  return rawToolCalls.flatMap(toolCall => {
    if (
      toolCall.type !== "function" ||
      toolCall.function?.name !== "read_attachment_chunk"
    ) {
      return [];
    }
    const args = parseToolArguments(toolCall.function.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args)) return [];
    const request = createAttachmentReadFromRecord(
      args as Record<string, unknown>,
    );
    return request ? [request] : [];
  });
}

async function consumeStructuredSse(
  body: ReadableStream<Uint8Array> | null,
  consumePayload: (payload: Record<string, unknown>) => void,
): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trimStart();
    if (!data || data === '[DONE]') return;
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      consumePayload(payload);
    } catch {
      // 忽略损坏的单个 SSE 分片，后续事件仍可继续接收。
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      if (rawText.length > maxSseResponseChars) {
        await reader.cancel('AI response too large').catch(() => undefined);
        throw new Error('AI_RESPONSE_TOO_LARGE');
      }
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
    }
    const finalChunk = decoder.decode();
    rawText += finalChunk;
    buffer += finalChunk;
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }
  return rawText;
}

async function collectAnthropicSseStream(
  body: ReadableStream<Uint8Array> | null,
  sendChunk?: (text: string) => void,
): Promise<{
  contentText: string;
  toolCalls: StreamedToolCall[];
  rawResponseText: string;
}> {
  let contentText = '';
  const toolCalls = new Map<number, StreamedToolCall>();
  const rawResponseText = await consumeStructuredSse(body, payload => {
    const type = payload.type;
    const index = typeof payload.index === 'number' ? payload.index : 0;
    if (type === 'content_block_start') {
      const block = payload.content_block as Record<string, unknown> | undefined;
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        toolCalls.set(index, {
          id: typeof block.id === 'string' ? block.id : '',
          name: block.name,
          arguments:
            block.input && typeof block.input === 'object' &&
            Object.keys(block.input as Record<string, unknown>).length > 0
              ? JSON.stringify(block.input)
              : '',
        });
      }
      return;
    }
    if (type !== 'content_block_delta') return;
    const delta = payload.delta as Record<string, unknown> | undefined;
    if (!delta) return;
    const text = collectTextValues([delta.thinking, delta.text]);
    if (text) {
      contentText += text;
      sendChunk?.(text);
    }
    if (typeof delta.partial_json === 'string') {
      const toolCall = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
      toolCall.arguments += delta.partial_json;
      toolCalls.set(index, toolCall);
    }
  });
  return {
    contentText,
    toolCalls: [...toolCalls.values()].filter(toolCall => toolCall.name),
    rawResponseText,
  };
}

async function collectResponsesSseStream(
  body: ReadableStream<Uint8Array> | null,
  sendChunk?: (text: string) => void,
): Promise<{
  contentText: string;
  toolCalls: StreamedToolCall[];
  rawResponseText: string;
}> {
  let contentText = '';
  const toolCalls = new Map<string, StreamedToolCall>();
  const rawResponseText = await consumeStructuredSse(body, payload => {
    const type = typeof payload.type === 'string' ? payload.type : '';
    if (
      type === 'response.output_text.delta' ||
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning_text.delta'
    ) {
      if (typeof payload.delta === 'string' && payload.delta) {
        contentText += payload.delta;
        sendChunk?.(payload.delta);
      }
      return;
    }
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = payload.item as Record<string, unknown> | undefined;
      if (item?.type !== 'function_call' || typeof item.name !== 'string') return;
      const key = typeof item.id === 'string'
        ? item.id
        : typeof item.call_id === 'string'
          ? item.call_id
          : String(payload.output_index ?? 0);
      const existing = toolCalls.get(key);
      toolCalls.set(key, {
        id: typeof item.call_id === 'string' ? item.call_id : key,
        name: item.name,
        arguments: existing?.arguments || (typeof item.arguments === 'string' ? item.arguments : ''),
      });
      return;
    }
    if (type === 'response.function_call_arguments.delta') {
      const key = typeof payload.item_id === 'string'
        ? payload.item_id
        : String(payload.output_index ?? 0);
      const existing = toolCalls.get(key) ?? { id: key, name: '', arguments: '' };
      if (typeof payload.delta === 'string') existing.arguments += payload.delta;
      toolCalls.set(key, existing);
    }
  });
  return {
    contentText,
    toolCalls: [...toolCalls.values()].filter(toolCall => toolCall.name),
    rawResponseText,
  };
}

export function collectAiApiStream(
  spec: AiApiSpec,
  body: ReadableStream<Uint8Array> | null,
  sendChunk?: (text: string) => void,
): Promise<{
  contentText: string;
  toolCalls: StreamedToolCall[];
  rawResponseText: string;
}> {
  if (spec === 'anthropic') return collectAnthropicSseStream(body, sendChunk);
  if (spec === 'responses') return collectResponsesSseStream(body, sendChunk);
  return collectSseStream(body, sendChunk);
}
