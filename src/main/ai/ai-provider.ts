import type { AiChatInput } from "../../shared/ai.js";
import type {
  AiModelConfig,
  AiProvider,
  AppSettings,
} from "../../shared/settings.js";
import { writeAppLog } from "../logger.js";
import { getTerminalContextSnapshot } from "../ssh/session-manager.js";
import {
  buildAiMessages,
  truncateText,
  type ExecutedAiCommandContext,
} from "./ai-context.js";
import {
  collectSseStream,
  parseRunShellToolCalls,
  type ParsedAssistantResponse,
  type RawToolCall,
} from "./ai-response-parser.js";

export type {
  ParsedAiCommand,
  ParsedAssistantResponse,
} from "./ai-response-parser.js";

const aiProviderLabels: Record<AiProvider, string> = {
  deepseek: "DeepSeek",
  glm: "GLM",
  other: "其他",
};

const aiTools = [
  {
    type: "function" as const,
    function: {
      name: "run_shell_command",
      description: "在远程服务器上执行一条 Shell 命令，用于查看系统状态、日志、文件、进程等。",
      parameters: {
        type: "object" as const,
        properties: {
          command: { type: "string", description: "要执行的完整 Shell 命令" },
          reason: { type: "string", description: "为什么执行这条命令，用中文简短说明" },
          risk: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "命令风险级别：low=只读查询，medium=可能有副作用，high=写入、删除、重启或权限提升",
          },
        },
        required: ["command", "reason", "risk"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];

function summarizeToolCalls(rawToolCalls: RawToolCall[]) {
  return rawToolCalls.map(toolCall => ({
    name: toolCall.function?.name ?? "",
    argumentsLength:
      typeof toolCall.function?.arguments === "string"
        ? toolCall.function.arguments.length
        : JSON.stringify(toolCall.function?.arguments ?? null).length,
  }));
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  return getErrorCode(record.cause);
}

function createAiRequestErrorResponse(error: unknown): ParsedAssistantResponse {
  if (error instanceof Error && error.message === "AI_RESPONSE_TOO_LARGE") {
    return { reply: "AI 服务响应过大，已停止接收。", commands: [] };
  }
  if (getErrorCode(error) === "UND_ERR_CONNECT_TIMEOUT") {
    return { reply: "无法连接 AI 服务：连接超时。请检查网络、代理或防火墙设置后重试。", commands: [] };
  }
  return { reply: "无法连接 AI 服务。请检查网络、代理配置或稍后重试。", commands: [] };
}

function getActiveAiConfig(settings: AppSettings): AiModelConfig | null {
  const activeConfig =
    settings.ai.configs.find(config => config.id === settings.ai.activeConfigId) ??
    settings.ai.configs[0];
  if (
    !settings.ai.enabled ||
    !activeConfig ||
    activeConfig.spec !== "openai" ||
    !activeConfig.baseUrl.trim() ||
    !activeConfig.apiKey.trim() ||
    !activeConfig.model.trim()
  ) {
    return null;
  }
  return {
    ...activeConfig,
    baseUrl: activeConfig.baseUrl.trim().replace(/\/+$/, ""),
    apiKey: activeConfig.apiKey.trim(),
    model: activeConfig.model.trim(),
  };
}

async function createAiStatusErrorResponse(response: Response): Promise<ParsedAssistantResponse> {
  const responseText = await response.text().catch(() => "");
  const detail = responseText ? `，返回信息：${truncateText(responseText, 300)}` : "";
  return { reply: `AI 请求失败（HTTP ${response.status}）${detail}`, commands: [] };
}

function createLocalFallback(
  input: AiChatInput,
  executedCommands: ExecutedAiCommandContext[],
): ParsedAssistantResponse {
  if (executedCommands.length > 0) {
    return {
      reply: `已完成 ${executedCommands.length} 条命令检查，请根据上方命令输出判断当前状态。`,
      commands: [],
    };
  }
  const lower = input.message.toLowerCase();
  if (lower.includes("disk") || input.message.includes("磁盘")) {
    return {
      reply: "可以先查看磁盘使用率。我建议执行 df -h。",
      commands: [{ command: "df -h", reason: "查看文件系统使用率", risk: "low" }],
    };
  }
  if (lower.includes("nginx")) {
    return {
      reply: "可以先查看 nginx 的服务状态。",
      commands: [{ command: "systemctl status nginx", reason: "查看 nginx 服务状态", risk: "low" }],
    };
  }
  return { reply: "我可以根据当前服务器上下文给出建议；如果需要诊断，请描述现象或指定服务名。", commands: [] };
}

export async function requestAiTurn(
  input: AiChatInput,
  settings: AppSettings,
  executedCommands: ExecutedAiCommandContext[],
  signal?: AbortSignal,
  sendChunk?: (text: string) => void,
): Promise<ParsedAssistantResponse> {
  const terminalOutput = settings.ai.shareTerminalContext
    ? (getTerminalContextSnapshot(input.tabId)?.recentOutput ?? "")
    : "";
  const activeConfig = getActiveAiConfig(settings);
  if (!activeConfig) return createLocalFallback(input, executedCommands);

  const providerName = aiProviderLabels[activeConfig.provider] ?? activeConfig.name;
  try {
    writeAppLog({
      scope: "main.ai",
      message: "AI 对话请求开始",
      data: {
        provider: providerName,
        configName: activeConfig.name,
        model: activeConfig.model,
        tabId: input.tabId,
        mode: input.mode,
        executedCommandCount: executedCommands.length,
        streaming: Boolean(sendChunk),
        sharedTerminalContext: settings.ai.shareTerminalContext,
      },
    });
    const fetchBody: Record<string, unknown> = {
      model: activeConfig.model,
      messages: buildAiMessages(input, executedCommands, terminalOutput),
      tools: aiTools,
    };
    if (sendChunk) fetchBody.stream = true;
    const response = await fetch(`${activeConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${activeConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fetchBody),
      signal,
    });
    if (!response.ok) return createAiStatusErrorResponse(response);

    let reply = "";
    let normalizedToolCalls: RawToolCall[] = [];
    if (sendChunk && response.body) {
      const streamed = await collectSseStream(response.body, sendChunk);
      reply = streamed.contentText;
      normalizedToolCalls = streamed.toolCalls.map(toolCall => ({
        id: toolCall.id,
        type: "function",
        function: { name: toolCall.name, arguments: toolCall.arguments },
      }));
    } else {
      const payload = (await response.json()) as Record<string, unknown>;
      const choice = (payload.choices as Array<Record<string, unknown>>)?.[0];
      const message = (choice?.message ?? {}) as Record<string, unknown>;
      reply = typeof message.content === "string" ? message.content.trim() : "";
      normalizedToolCalls = ((message.tool_calls as RawToolCall[]) ?? []).slice();
      const legacy = message.function_call as Record<string, unknown> | undefined;
      if (typeof legacy?.name === "string" && typeof legacy.arguments === "string") {
        normalizedToolCalls.push({
          type: "function",
          function: { name: legacy.name, arguments: legacy.arguments },
        });
      }
    }

    const commands = parseRunShellToolCalls(normalizedToolCalls);
    if (normalizedToolCalls.length > 0 && commands.length === 0) {
      writeAppLog({
        scope: "main.ai",
        level: "warn",
        message: "AI 工具调用名称或参数无效",
        data: { provider: providerName, tabId: input.tabId, toolCalls: summarizeToolCalls(normalizedToolCalls) },
      });
    }
    writeAppLog({
      scope: "main.ai",
      message: "AI 对话请求完成",
      data: {
        provider: providerName,
        tabId: input.tabId,
        contentLength: reply.length,
        toolCallCount: normalizedToolCalls.length,
        hasCommands: commands.length > 0,
      },
    });
    return { reply, commands };
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return { reply: "[已终止]", commands: [] };
    }
    writeAppLog({
      scope: "main.ai",
      message: "AI 对话请求失败",
      data: {
        provider: providerName,
        tabId: input.tabId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return createAiRequestErrorResponse(error);
  }
}
