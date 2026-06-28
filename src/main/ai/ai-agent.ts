import type {
  AiChatInput,
  AiChatResult,
  AiCommandCard,
  AiMessage,
} from "../../shared/ai.js";
import type { AppSettings } from "../../shared/settings.js";
import { getTerminalContextSnapshot } from "../ssh/session-manager.js";
import { evaluateAiCommand } from "./ai-tools.js";

interface ParsedAssistantResponse {
  reply?: string;
  commands?: Array<{
    command?: string;
    reason?: string;
    risk?: "low" | "medium" | "high";
  }>;
}

function createId(): string {
  return crypto.randomUUID();
}

function truncateText(text: string, limit = 5000): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`
    : text;
}

function buildSystemPrompt(input: AiChatInput, remoteOutput: string): string {
  return [
    "You are OrbitSSH's AI assistant inside an SSH client.",
    "Never reveal, request, or guess passwords, private keys, tokens, or secrets.",
    "Do not claim a command was executed unless a tool result is provided.",
    "Return strict JSON only, with this shape:",
    '{"reply":"short helpful answer","commands":[{"command":"...","reason":"...","risk":"low|medium|high"}]}',
    "For readonly diagnostics, suggest at most two commands.",
    "For write or risky operations, suggest a command card and explain the risk.",
    `Current mode: ${input.mode}.`,
    `Current tab: ${input.context.tabId || "none"}.`,
    `Server: ${input.context.serverName || "unknown"}.`,
    `Current path: ${input.context.currentPath || input.context.sftpPath || "unknown"}.`,
    `Status: ${input.context.status || "unknown"}.`,
    `Recent terminal output:\n${truncateText(remoteOutput, 3000)}`,
  ].join("\n");
}

function parseAssistantResponse(raw: string): ParsedAssistantResponse {
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const jsonText =
      jsonStart >= 0 && jsonEnd > jsonStart
        ? raw.slice(jsonStart, jsonEnd + 1)
        : raw;
    return JSON.parse(jsonText) as ParsedAssistantResponse;
  } catch {
    return { reply: raw, commands: [] };
  }
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap(item => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        return [];
      }
      return content.flatMap(part => {
        if (!part || typeof part !== "object") {
          return [];
        }
        const partRecord = part as Record<string, unknown>;
        return typeof partRecord.text === "string" ? [partRecord.text] : [];
      });
    })
    .join("\n")
    .trim();
}

function createLocalFallback(input: AiChatInput): ParsedAssistantResponse {
  const lower = input.message.toLowerCase();

  if (lower.includes("disk") || input.message.includes("磁盘")) {
    return {
      reply: "可以先查看磁盘使用率。我建议执行 df -h。",
      commands: [{ command: "df -h", reason: "Check filesystem usage", risk: "low" }],
    };
  }

  if (lower.includes("nginx")) {
    return {
      reply: "可以先查看 nginx 的服务状态和最近日志。",
      commands: [
        {
          command: "systemctl status nginx",
          reason: "Check nginx service status",
          risk: "low",
        },
        {
          command: "journalctl -u nginx -n 100 --no-pager",
          reason: "Read recent nginx service logs",
          risk: "low",
        },
      ],
    };
  }

  return {
    reply: "我可以根据当前服务器上下文给出建议；如果需要诊断，请描述现象或指定服务名。",
    commands: [],
  };
}

function createCommandCards(
  input: AiChatInput,
  parsed: ParsedAssistantResponse,
): AiCommandCard[] {
  if (input.mode === "suggest") {
    return [];
  }

  return (parsed.commands ?? [])
    .filter(command => command.command?.trim())
    .slice(0, 3)
    .map(command => {
      const text = command.command?.trim() ?? "";
      const policy = evaluateAiCommand(text);
      return {
        id: createId(),
        tabId: input.tabId,
        command: text,
        reason: command.reason || policy.reason,
        risk: command.risk ?? (policy.decision === "allow_readonly" ? "low" : "medium"),
        status:
          policy.decision === "allow_readonly" && input.mode !== "suggest"
            ? "pending"
            : "requires_approval",
      };
    });
}

export async function runAiChat(
  input: AiChatInput,
  settings: AppSettings,
): Promise<AiChatResult> {
  const snapshot = input.tabId
    ? getTerminalContextSnapshot(input.tabId)
    : undefined;
  const systemPrompt = buildSystemPrompt(
    input,
    snapshot?.recentOutput ?? "",
  );

  let parsed: ParsedAssistantResponse;

  if (!settings.ai.enabled || !settings.ai.apiKey.trim()) {
    parsed = createLocalFallback(input);
  } else {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.ai.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.ai.model || "gpt-5-mini",
        instructions: systemPrompt,
        input: [
          ...input.history.slice(-8).map(message => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content,
          })),
          { role: "user", content: input.message },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const payload = await response.json() as unknown;
    parsed = parseAssistantResponse(extractOutputText(payload));
  }

  const message: AiMessage = {
    id: createId(),
    role: "assistant",
    content: parsed.reply || "No response.",
    createdAt: Date.now(),
  };

  return {
    message,
    commandCards: createCommandCards(input, parsed),
  };
}
