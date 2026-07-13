export interface ParsedAssistantResponse {
  reply?: string;
  commands?: ParsedAiCommand[];
}

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
): Promise<{ contentText: string; toolCalls: StreamedToolCall[] }> {
  if (!body) return { contentText: "", toolCalls: [] };
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
    return { contentText, toolCalls: streamedToolCalls };
  }

  let fallbackContent = "";
  const fallbackToolCalls: StreamedToolCall[] = [];
  try {
    const payload = JSON.parse(rawText) as Record<string, unknown>;
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
  return { contentText: fallbackContent, toolCalls: fallbackToolCalls };
}
