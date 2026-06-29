import type {
  AiApprovedCommandInput,
  AiCancelInput,
  AiChatInput,
  AiChatResult,
  AiCommandCard,
  AiCommandResult,
  AiMessage,
  AiRejectedCommandInput,
  AiStreamChunkEvent,
} from "../../shared/ai.js";
import type { AiModelConfig, AiProvider, AppSettings } from "../../shared/settings.js";
import type { WebContents } from "electron";
import { writeAppLog } from "../logger.js";
import { executeTerminalCommand } from "../ssh/session-manager.js";
import { getTerminalContextSnapshot } from "../ssh/session-manager.js";
import {
  evaluateAiCommand,
  isAutoAllowedQueryCommand,
  requiresMandatoryApproval,
} from "./command-policy.js";

interface ParsedAssistantResponse {
  reply?: string;
  commands?: Array<{
    command?: string;
    reason?: string;
    risk?: "low" | "medium" | "high";
  }>;
}

interface ExecutedAiCommandContext {
  command: string;
  reason: string;
  risk: "low" | "medium" | "high";
  result: AiCommandResult;
}

type ParsedAiCommand = {
  command: string;
  reason: string;
  risk: "low" | "medium" | "high";
};

interface PendingApprovalState {
  input: AiChatInput;
  command: string;
  reason: string;
  risk: "low" | "medium" | "high";
  cardId: string;
  previousCards: AiCommandCard[];
  executedCommands: ExecutedAiCommandContext[];
  createdAt: number;
}

const aiProviderLabels: Record<AiProvider, string> = {
  deepseek: "DeepSeek",
  glm: "GLM",
  other: "其他",
};

interface StreamedToolCall {
  id: string;
  name: string;
  arguments: string;
}

const aiTools = [
  {
    type: "function" as const,
    function: {
      name: "run_shell_command",
      description:
        "在远程服务器上执行一条 Shell 命令，用于查看系统状态、日志、文件、进程等。",
      parameters: {
        type: "object" as const,
        properties: {
          command: {
            type: "string",
            description: "要执行的完整 Shell 命令",
          },
          reason: {
            type: "string",
            description: "为什么执行这条命令，用中文简短说明",
          },
          risk: {
            type: "string",
            enum: ["low", "medium", "high"],
            description:
              "命令的风险级别：low=只读查询，medium=可能有副作用，high=涉及写入/删除/重启/权限提升",
          },
        },
        required: ["command", "reason", "risk"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];

const maxAgentCommandCount = 6;
const approvalTtlMs = 5 * 60 * 1000;
const pendingApprovals = new Map<string, PendingApprovalState>();
const activeRequests = new Map<string, AbortController>();

function createId(): string {
  return crypto.randomUUID();
}

function truncateText(text: string, limit = 5000): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n... [已截断 ${text.length - limit} 个字符]`
    : text;
}

function formatExecutedCommands(
  executedCommands: ExecutedAiCommandContext[],
): string {
  if (executedCommands.length === 0) {
    return "暂无已执行命令。";
  }

  return executedCommands
    .map((item, index) => {
      const output = [item.result.stdout, item.result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
      return [
        `#${index + 1} ${item.command}`,
        `退出码：${item.result.exitCode ?? "未知"}`,
        `耗时：${item.result.durationMs}ms`,
        `输出：\n${truncateText(output || "无输出", 10000)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildSystemPrompt(
  input: AiChatInput,
  remoteOutput: string,
  executedCommands: ExecutedAiCommandContext[],
): string {
  return [
    "你是 OrbitSSH 内置在 SSH 客户端里的 AI 助手。",
    "不要泄露、索要或猜测密码、私钥、令牌等敏感信息。",
    "除非上下文里明确提供了命令执行结果，否则不要声称某条命令已经执行。",
    "用简洁中文回复。需要执行 Shell 命令时调用 run_shell_command 工具。",
    "每次最多调用一次工具，除非已经可以回答用户问题。",
    "如果已有命令结果足够回答用户问题，不要调用工具，直接在回复里总结结论。",
    "如果还需要继续检查，请调用 run_shell_command 工具提供下一条命令。",
    "涉及写入、重启、删除、权限提升或其他高风险操作时，risk 必须标记为 high。",
    "模式说明：ask 表示每条命令都需要用户批准；auto 表示只读或有边界的中等范围查询可自动执行，其他命令需批准；full 表示除必须批准或 high 风险命令外可自动执行。",
    "回答必须使用中文；命令、路径、服务名和错误文本保持原样。",
    `当前模式：${input.mode}。`,
    `当前标签页：${input.context.tabId || "无"}。`,
    `服务器：${input.context.serverName || "未知"}。`,
    `当前路径：${input.context.currentPath || input.context.sftpPath || "未知"}。`,
    `连接状态：${input.context.status || "未知"}。`,
    `已执行命令结果：\n${formatExecutedCommands(executedCommands)}`,
    `最近终端输出：\n${truncateText(remoteOutput, 3000)}`,
  ].join("\n");
}

function buildAiMessages(
  input: AiChatInput,
  systemPrompt: string,
): Array<{
  role: "system" | "assistant" | "user";
  content: string;
}> {
  const visibleHistory = input.history.filter(message => {
    // 过滤前端/主进程生成的内部状态文案，避免污染后续模型上下文。
    if (message.role !== "assistant") return true;

    const content = message.content.trim();
    return content !== "未收到有效回复。" && content !== "正在执行命令…";
  });

  return [
    { role: "system", content: systemPrompt },
    ...visibleHistory.slice(-8).map(message => ({
      role:
        message.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
      content: message.content,
    })),
    { role: "user", content: input.message },
  ];
}

function normalizeAiCommandRisk(value: unknown): ParsedAiCommand["risk"] {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : "medium";
}

function parseToolArguments(rawArgs: unknown): unknown {
  if (rawArgs && typeof rawArgs === "object") {
    return rawArgs;
  }

  if (typeof rawArgs !== "string") {
    return {};
  }

  let parsed: unknown = rawArgs;

  // 兼容部分模型把 arguments 二次 JSON 编码为字符串的情况。
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

function extractCommandFromLooseJson(text: string): string {
  // 仅作为 malformed tool arguments 的兜底，正常路径仍使用 JSON.parse。
  const match = text.match(
    /["'](?:command|cmd|shell|script|commandLine|command_line)["']\s*:\s*["']([^"']+)["']/,
  );

  return match?.[1]?.trim() ?? "";
}

function createCommandFromRecord(
  record: Record<string, unknown>,
  fallbackReason = "执行命令",
): ParsedAiCommand | null {
  const command =
    typeof record.command === "string"
      ? record.command
      : typeof record.cmd === "string"
        ? record.cmd
        : typeof record.shell === "string"
          ? record.shell
          : typeof record.script === "string"
            ? record.script
            : typeof record.commandLine === "string"
              ? record.commandLine
              : typeof record.command_line === "string"
                ? record.command_line
                : "";
  const normalizedCommand = command.trim();

  if (!normalizedCommand) {
    return null;
  }

  return {
    command: normalizedCommand,
    reason:
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason.trim()
        : fallbackReason,
    risk: normalizeAiCommandRisk(record.risk),
  };
}

function buildCommandsFromToolArguments(rawArgs: unknown): ParsedAiCommand[] {
  const args = parseToolArguments(rawArgs);

  if (!args || typeof args !== "object") {
    return [];
  }

  const record = args as Record<string, unknown>;
  const fallbackReason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : "执行命令";

  if (Array.isArray(record.commands)) {
    return record.commands
      .map(item => {
        if (typeof item === "string") {
          return createCommandFromRecord(
            { command: item, reason: fallbackReason, risk: record.risk },
            fallbackReason,
          );
        }

        if (item && typeof item === "object") {
          return createCommandFromRecord(
            item as Record<string, unknown>,
            fallbackReason,
          );
        }

        return null;
      })
      .filter((item): item is ParsedAiCommand => item !== null);
  }

  const singleCommand = createCommandFromRecord(record, fallbackReason);
  return singleCommand ? [singleCommand] : [];
}

function buildToolCallCommands(
  rawToolCalls: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: unknown } }>,
): ParsedAiCommand[] {
  return rawToolCalls.flatMap(tc =>
    buildCommandsFromToolArguments(tc.function?.arguments),
  );
}

function summarizeToolCalls(
  rawToolCalls: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: unknown } }>,
): Array<{ name: string; argumentsPreview: string }> {
  return rawToolCalls.map(tc => ({
    name: tc.function?.name ?? "",
    argumentsPreview:
      typeof tc.function?.arguments === "string"
        ? truncateText(tc.function.arguments, 500)
        : truncateText(JSON.stringify(tc.function?.arguments ?? null), 500),
  }));
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") {
    return record.code;
  }

  const cause = record.cause;
  if (cause && typeof cause === "object") {
    return getErrorCode(cause);
  }

  return "";
}

function createAiRequestErrorResponse(error: unknown): ParsedAssistantResponse {
  const errorCode = getErrorCode(error);

  if (errorCode === "UND_ERR_CONNECT_TIMEOUT") {
    return {
      reply: "无法连接 AI 服务：连接超时。请检查网络、代理或防火墙设置后重试。",
      commands: [],
    };
  }

  return {
    reply: "无法连接 AI 服务。请检查网络、代理配置或稍后重试。",
    commands: [],
  };
}

// 获取当前启用的 AI 配置；配置不完整时回退本地建议，避免发起无效网络请求。
function getActiveAiConfig(settings: AppSettings): AiModelConfig | null {
  const activeConfig = settings.ai.configs.find(
    config => config.id === settings.ai.activeConfigId,
  ) ?? settings.ai.configs[0];

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

async function createAiStatusErrorResponse(
  response: Response,
): Promise<ParsedAssistantResponse> {
  const responseText = await response.text().catch(() => "");
  const detail = responseText
    ? `，返回信息：${truncateText(responseText, 300)}`
    : "";

  return {
    reply: `AI 请求失败（HTTP ${response.status}）${detail}`,
    commands: [],
  };
}

function createLocalFallback(
  input: AiChatInput,
  executedCommands: ExecutedAiCommandContext[] = [],
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
      commands: [
        { command: "df -h", reason: "查看文件系统使用率", risk: "low" },
      ],
    };
  }

  if (lower.includes("nginx")) {
    return {
      reply: "可以先查看 nginx 的服务状态和最近日志。",
      commands: [
        {
          command: "systemctl status nginx",
          reason: "查看 nginx 服务状态",
          risk: "low",
        },
        {
          command: "journalctl -u nginx -n 100 --no-pager",
          reason: "查看 nginx 最近日志",
          risk: "low",
        },
      ],
    };
  }

  return {
    reply:
      "我可以根据当前服务器上下文给出建议；如果需要诊断，请描述现象或指定服务名。",
    commands: [],
  };
}

function getNextParsedCommand(parsed: ParsedAssistantResponse): {
  command: string;
  reason: string;
  risk: "low" | "medium" | "high";
} | null {
  const command = (parsed.commands ?? []).find(item => item.command?.trim());

  if (!command?.command?.trim()) {
    return null;
  }

  const text = command.command.trim();
  const policy = evaluateAiCommand(text);

  return {
    command: text,
    reason: command.reason || policy.reason,
    risk:
      command.risk ?? (policy.decision === "allow_readonly" ? "low" : "medium"),
  };
}

function shouldRequestApproval(
  mode: AiChatInput["mode"],
  command: string,
  risk: "low" | "medium" | "high",
): boolean {
  if (mode === "ask") {
    return true;
  }

  if (mode === "auto") {
    return !isAutoAllowedQueryCommand(command);
  }

  return requiresMandatoryApproval(command, risk);
}

function createAssistantMessage(content: string): AiMessage {
  return {
    id: createId(),
    role: "assistant",
    content: content || "未收到有效回复。",
    createdAt: Date.now(),
  };
}

function createApprovalCard(
  input: AiChatInput,
  command: string,
  reason: string,
  risk: "low" | "medium" | "high",
  approvalId: string,
  cardId = createId(),
): AiCommandCard {
  return {
    id: cardId,
    tabId: input.tabId,
    command,
    reason,
    risk,
    status: "requires_approval",
    createdAt: Date.now(),
    approvalId,
  };
}

function createCompletedCard(
  input: AiChatInput,
  command: string,
  reason: string,
  risk: "low" | "medium" | "high",
  result: AiCommandResult,
  cardId = createId(),
  createdAt = Date.now(),
  approvalId?: string,
): AiCommandCard {
  return {
    id: cardId,
    tabId: input.tabId,
    command,
    reason,
    risk,
    status: "completed",
    createdAt,
    approvalId,
    result,
  };
}

function createFailedCard(
  input: AiChatInput,
  command: string,
  reason: string,
  risk: "low" | "medium" | "high",
  error: unknown,
  cardId = createId(),
  createdAt = Date.now(),
): AiCommandCard {
  return {
    id: cardId,
    tabId: input.tabId,
    command,
    reason,
    risk,
    status: "failed",
    createdAt,
    error: error instanceof Error ? error.message : String(error),
  };
}

function mergeCards(
  previousCards: AiCommandCard[],
  nextCard: AiCommandCard,
): AiCommandCard[] {
  const index = previousCards.findIndex(card => card.id === nextCard.id);

  if (index < 0) {
    return [...previousCards, nextCard];
  }

  return previousCards.map(card => (card.id === nextCard.id ? nextCard : card));
}

// ----- SSE 流式解析（区分 content 文本与 tool_call delta） -----
//
// 解码策略分两层，兼容两种后端行为：
// 1. 标准 SSE（text/event-stream）：逐行 "data: " 前缀的 JSON 分片。
// 2. 非流式 JSON 回退：部分提供商的流式端点可能在带 tools 时仍返回
//    普通 JSON（或 SSE 嵌套 JSON），此时从 choices[0].message 提取。
//
// 通用 OpenAI 兼容的 SSE delta 结构：
//   { "choices": [{ "delta": { "content": "…", "tool_calls": […] } }] }
// 非流式回退结构：
//   { "choices": [{ "message": { "content": "…", "tool_calls": […] } }] }

async function collectSseStream(
  body: ReadableStream<Uint8Array> | null,
  sendChunk?: (text: string) => void,
): Promise<{ contentText: string; toolCalls: StreamedToolCall[] }> {
  if (!body) return { contentText: "", toolCalls: [] };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let contentText = "";
  const toolCallsByIndex = new Map<number, StreamedToolCall>();

  // 同时保留原始文本用于最后兜底解析（非流式 JSON 回退）。
  let rawText = "";

  // 兼容 OpenAI 新版 tool_calls 和部分兼容接口仍在使用的旧版 function_call。
  const appendToolCallDelta = (
    index: number,
    id: unknown,
    name: unknown,
    args: unknown,
  ): void => {
    const existing = toolCallsByIndex.get(index) ?? {
      id: "",
      name: "",
      arguments: "",
    };

    if (typeof id === "string" && id) existing.id = id;
    if (typeof name === "string" && name) existing.name = name;
    if (typeof args === "string" && args) existing.arguments += args;

    toolCallsByIndex.set(index, existing);
  };

  // 逐行解析 SSE 数据，流结束后也会复用它处理最后一段未换行内容。
  const consumeSseLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data: ")) return;

    const data = trimmed.slice(6).trim();
    if (data === "[DONE]") return;

    try {
      const parsed = JSON.parse(data);
      const choice = parsed?.choices?.[0];
      const delta = choice?.delta;
      const message = choice?.message;
      const packet = delta ?? message;
      if (!packet) return;

      // 自然语言文本：直接推给渲染进程展示
      const content = packet.content;
      if (typeof content === "string" && content) {
        contentText += content;
        sendChunk?.(content);
      }

      // 工具调用 delta：后台累积，不推给渲染进程
      const deltaToolCalls = packet.tool_calls;
      if (Array.isArray(deltaToolCalls)) {
        for (const tc of deltaToolCalls) {
          appendToolCallDelta(
            typeof tc.index === "number" ? tc.index : 0,
            tc.id,
            tc.function?.name,
            tc.function?.arguments,
          );
        }
      }

      const legacyFunctionCall = packet.function_call;
      if (legacyFunctionCall) {
        appendToolCallDelta(
          0,
          "",
          legacyFunctionCall.name,
          legacyFunctionCall.arguments,
        );
      }
    } catch {
      // 跳过无法解析的行
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        consumeSseLine(line);
      }
    }

    const finalChunk = decoder.decode();
    if (finalChunk) {
      rawText += finalChunk;
      buffer += finalChunk;
    }

    // 有些兼容接口最后一条 data 不带换行，必须在流结束后补处理。
    if (buffer.trim()) {
      consumeSseLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  const streamedToolCalls = Array.from(toolCallsByIndex.values()).filter(
    (tc) => tc.name && tc.arguments,
  );

  // SSE 路径拿到了内容或工具调用，直接返回
  if (contentText || streamedToolCalls.length > 0) {
    return { contentText, toolCalls: streamedToolCalls };
  }

  // ----- 非流式 JSON 回退 -----
  // SSE 没拿到任何 token 时，尝试把整个响应体当成一个 JSON 对象解析。
  let fallbackContent = "";
  const fallbackToolCalls: StreamedToolCall[] = [];

  try {
    const payload = JSON.parse(rawText) as Record<string, unknown>;
    const choice = (payload.choices as Array<Record<string, unknown>>)?.[0];
    const message = (choice?.message ?? {}) as Record<string, unknown>;

    fallbackContent =
      typeof message.content === "string" ? message.content.trim() : "";

    const rawToolCalls = (message.tool_calls as Array<Record<string, unknown>>) ?? [];
    for (const tc of rawToolCalls) {
      const fn = tc.function as Record<string, unknown> | undefined;
      if (fn?.name && typeof fn.arguments === "string") {
        fallbackToolCalls.push({
          id: typeof tc.id === "string" ? tc.id : "",
          name: String(fn.name),
          arguments: fn.arguments,
        });
      }
    }

    const legacyFunctionCall = message.function_call as
      | Record<string, unknown>
      | undefined;
    if (
      legacyFunctionCall?.name &&
      typeof legacyFunctionCall.arguments === "string"
    ) {
      fallbackToolCalls.push({
        id: "",
        name: String(legacyFunctionCall.name),
        arguments: legacyFunctionCall.arguments,
      });
    }
  } catch {
    // 回退解析失败，保持空结果
  }

  if (fallbackContent) {
    // 回退拿到的文本是完整回复，一次性推给渲染进程
    sendChunk?.(fallbackContent);
  }

  writeAppLog({
    scope: "main.ai",
    message: fallbackContent || fallbackToolCalls.length > 0
      ? "SSE 无增量，已用非流式 JSON 回退解析"
      : "SSE 与回退均无有效内容",
    data: {
      rawLen: rawText.length,
      rawPreview: rawText.slice(0, 500),
    },
  });

  return { contentText: fallbackContent, toolCalls: fallbackToolCalls };
}

async function requestAiTurn(
  input: AiChatInput,
  settings: AppSettings,
  executedCommands: ExecutedAiCommandContext[],
  signal?: AbortSignal,
  sendChunk?: (text: string) => void,
): Promise<ParsedAssistantResponse> {
  const snapshot = input.tabId
    ? getTerminalContextSnapshot(input.tabId)
    : undefined;
  const systemPrompt = buildSystemPrompt(
    input,
    snapshot?.recentOutput ?? "",
    executedCommands,
  );

  const activeConfig = getActiveAiConfig(settings);

  if (!activeConfig) {
    return createLocalFallback(input, executedCommands);
  }

  const providerName = aiProviderLabels[activeConfig.provider] ?? activeConfig.name;
  const requestUrl = `${activeConfig.baseUrl}/chat/completions`;

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
        streaming: !!sendChunk,
      },
    });

    const fetchBody: Record<string, unknown> = {
      model: activeConfig.model,
      messages: buildAiMessages(input, systemPrompt),
      tools: aiTools,
    };

    if (sendChunk) {
      fetchBody.stream = true;
    }

    // 网络或代理异常不继续抛给 IPC，转成面板内可读提示。
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${activeConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fetchBody),
      signal,
    });

    if (!response.ok) {
      writeAppLog({
        scope: "main.ai",
        message: "AI 对话请求返回异常状态",
        data: {
          provider: providerName,
          status: response.status,
          tabId: input.tabId,
        },
      });
      return createAiStatusErrorResponse(response);
    }

    // 流式路径：自然语言逐 token 推送，工具调用后台累积
    if (sendChunk && response.body) {
      const { contentText, toolCalls } = await collectSseStream(
        response.body,
        sendChunk,
      );

      // StreamedToolCall 的 arguments 在顶层，buildToolCallCommands 期望
      // { function: { arguments } } 嵌套格式，这里做一次适配。
      const commands = buildToolCallCommands(
        toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      );
      const normalizedToolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));

      if (normalizedToolCalls.length > 0 && commands.length === 0) {
        writeAppLog({
          scope: "main.ai",
          level: "warn",
          message: "AI 工具调用参数未解析出命令",
          data: {
            provider: providerName,
            tabId: input.tabId,
            toolCalls: summarizeToolCalls(normalizedToolCalls),
          },
        });
      }

      writeAppLog({
        scope: "main.ai",
        message: "AI 流式对话完成",
        data: {
          provider: providerName,
          tabId: input.tabId,
          contentLength: contentText.length,
          toolCallCount: toolCalls.length,
          hasCommands: commands.length > 0,
        },
      });

      return {
        reply: contentText || (commands.length > 0 ? "正在执行命令…" : "未收到有效回复。"),
        commands,
      };
    }

    // 非流式回退路径
    const payload = (await response.json()) as Record<string, unknown>;
    const choice = (payload.choices as Array<Record<string, unknown>>)?.[0];
    const message = (choice?.message ?? {}) as Record<string, unknown>;
    const reply = typeof message.content === "string" ? message.content.trim() : "";
    const rawToolCalls = (message.tool_calls as Array<Record<string, unknown>>) ?? [];
    const legacyFunctionCall = message.function_call as
      | Record<string, unknown>
      | undefined;
    const normalizedToolCalls = [...rawToolCalls];

    if (
      legacyFunctionCall?.name &&
      typeof legacyFunctionCall.arguments === "string"
    ) {
      normalizedToolCalls.push({
        type: "function",
        function: {
          name: String(legacyFunctionCall.name),
          arguments: legacyFunctionCall.arguments,
        },
      });
    }

    const commands = buildToolCallCommands(
      normalizedToolCalls as Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: unknown };
      }>,
    );

    if (normalizedToolCalls.length > 0 && commands.length === 0) {
      writeAppLog({
        scope: "main.ai",
        level: "warn",
        message: "AI 工具调用参数未解析出命令",
        data: {
          provider: providerName,
          tabId: input.tabId,
          toolCalls: summarizeToolCalls(
            normalizedToolCalls as Array<{
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: unknown };
            }>,
          ),
        },
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

    return {
      reply: reply || (commands.length > 0 ? "正在执行命令…" : "未收到有效回复。"),
      commands,
    };
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
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

async function runAgentLoop(
  input: AiChatInput,
  settings: AppSettings,
  signal: AbortSignal,
  sendChunk?: (text: string) => void,
  previousCards: AiCommandCard[] = [],
  executedCommands: ExecutedAiCommandContext[] = [],
): Promise<AiChatResult> {
  const replies: string[] = [];
  let commandCards = [...previousCards];

  while (executedCommands.length < maxAgentCommandCount) {
    if (signal.aborted) {
      return {
        message: createAssistantMessage(
          `${replies.join("\n\n")}\n\n[已终止]`.trim(),
        ),
        commandCards,
      };
    }

    // 多轮对话时，后续轮次的回复前插入分隔符
    const isFirstTurn = replies.length === 0;
    let turnFirstChunk = true;
    const onChunk = sendChunk
      ? (text: string) => {
          if (!isFirstTurn && turnFirstChunk) {
            sendChunk("\n\n");
          }
          turnFirstChunk = false;
          sendChunk(text);
        }
      : undefined;

    const parsed = await requestAiTurn(
      input,
      settings,
      executedCommands,
      signal,
      onChunk,
    );
    const reply = parsed.reply?.trim();

    if (reply) {
      replies.push(reply);
    }

    const nextCommand = getNextParsedCommand(parsed);

    if (!nextCommand) {
      return {
        message: createAssistantMessage(replies.join("\n\n")),
        commandCards,
      };
    }

    if (
      shouldRequestApproval(input.mode, nextCommand.command, nextCommand.risk)
    ) {
      const approvalId = createId();
      const cardId = createId();
      const approvalCard = createApprovalCard(
        input,
        nextCommand.command,
        nextCommand.reason,
        nextCommand.risk,
        approvalId,
        cardId,
      );

      pendingApprovals.set(approvalId, {
        input,
        command: nextCommand.command,
        reason: nextCommand.reason,
        risk: nextCommand.risk,
        cardId,
        previousCards: mergeCards(commandCards, approvalCard),
        executedCommands,
        createdAt: Date.now(),
      });

      return {
        message: createAssistantMessage(replies.join("\n\n")),
        commandCards: mergeCards(commandCards, approvalCard),
      };
    }

    try {
      writeAppLog({
        scope: "main.ai",
        message: "AI 命令自动执行开始",
        data: {
          tabId: input.tabId,
          mode: input.mode,
          command: nextCommand.command,
          risk: nextCommand.risk,
        },
      });
      const result = await executeTerminalCommand(
        input.tabId,
        nextCommand.command,
        20_000,
      );
      const completedCard = createCompletedCard(
        input,
        nextCommand.command,
        nextCommand.reason,
        nextCommand.risk,
        result,
      );
      commandCards = mergeCards(commandCards, completedCard);
      executedCommands = [
        ...executedCommands,
        {
          command: nextCommand.command,
          reason: nextCommand.reason,
          risk: nextCommand.risk,
          result,
        },
      ];
      writeAppLog({
        scope: "main.ai",
        message: "AI 命令自动执行完成",
        data: {
          tabId: input.tabId,
          command: nextCommand.command,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        },
      });
    } catch (error) {
      commandCards = mergeCards(
        commandCards,
        createFailedCard(
          input,
          nextCommand.command,
          nextCommand.reason,
          nextCommand.risk,
          error,
        ),
      );
      replies.push(
        `命令执行失败：${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        message: createAssistantMessage(replies.join("\n\n")),
        commandCards,
      };
    }
  }

  return {
    message: createAssistantMessage(
      `${replies.join("\n\n")}\n\n已达到单轮最多 ${maxAgentCommandCount} 条命令的限制，请根据当前结果继续提问。`.trim(),
    ),
    commandCards,
  };
}

export async function runAiChat(
  input: AiChatInput,
  settings: AppSettings,
  webContents?: WebContents,
): Promise<AiChatResult> {
  // 取消同一 Tab 上正在进行的请求（如有）
  const existing = activeRequests.get(input.tabId);
  if (existing) {
    existing.abort();
  }

  const controller = new AbortController();
  activeRequests.set(input.tabId, controller);

  const sendChunk = webContents
    ? (text: string) => {
        webContents.send("ai:stream-chunk", {
          tabId: input.tabId,
          chunk: text,
        } satisfies AiStreamChunkEvent);
      }
    : undefined;

  try {
    return await runAgentLoop(input, settings, controller.signal, sendChunk);
  } finally {
    if (activeRequests.get(input.tabId) === controller) {
      activeRequests.delete(input.tabId);
    }
  }
}

export function cancelAiRequest(input: AiCancelInput): boolean {
  const controller = activeRequests.get(input.tabId);
  if (!controller) return false;

  controller.abort();
  activeRequests.delete(input.tabId);

  writeAppLog({
    scope: "main.ai",
    message: "AI 请求已被用户终止",
    data: { tabId: input.tabId },
  });

  return true;
}

export async function runApprovedAiCommand(
  input: AiApprovedCommandInput,
  settings: AppSettings,
  webContents?: WebContents,
): Promise<AiChatResult> {
  const approval = pendingApprovals.get(input.approvalId);

  if (!approval) {
    throw new Error("命令授权不存在或已过期");
  }

  if (Date.now() - approval.createdAt > approvalTtlMs) {
    pendingApprovals.delete(input.approvalId);
    throw new Error("命令授权已过期");
  }

  if (
    approval.input.tabId !== input.tabId ||
    approval.command !== input.command.trim()
  ) {
    throw new Error("命令授权与当前命令不匹配");
  }

  pendingApprovals.delete(input.approvalId);

  let commandCards = approval.previousCards;
  const executedCommands = [...approval.executedCommands];

  try {
    const result = await executeTerminalCommand(
      input.tabId,
      approval.command,
      20_000,
    );
    const completedAt = Date.now();
    commandCards = mergeCards(
      commandCards,
      createCompletedCard(
        approval.input,
        approval.command,
        approval.reason,
        approval.risk,
        result,
        approval.cardId,
        completedAt,
        input.approvalId,
      ),
    );
    executedCommands.push({
      command: approval.command,
      reason: approval.reason,
      risk: approval.risk,
      result,
    });

    // 复用当前 Tab 的 AbortSignal，允许用户在批准后仍可终止执行
    const signal =
      activeRequests.get(input.tabId)?.signal ?? new AbortController().signal;
    const sendChunk = webContents
      ? (text: string) => {
          webContents.send("ai:stream-chunk", {
            tabId: input.tabId,
            chunk: text,
          } satisfies AiStreamChunkEvent);
        }
      : undefined;
    return runAgentLoop(
      approval.input,
      settings,
      signal,
      sendChunk,
      commandCards,
      executedCommands,
    );
  } catch (error) {
    const failedAt = Date.now();
    commandCards = mergeCards(
      commandCards,
      createFailedCard(
        approval.input,
        approval.command,
        approval.reason,
        approval.risk,
        error,
        approval.cardId,
        failedAt,
      ),
    );

    return {
      message: createAssistantMessage(
        `命令执行失败：${error instanceof Error ? error.message : String(error)}`,
      ),
      commandCards,
    };
  }
}

export function rejectAiCommandApproval(
  input: AiRejectedCommandInput,
): boolean {
  const approval = pendingApprovals.get(input.approvalId);

  if (!approval) {
    return false;
  }

  pendingApprovals.delete(input.approvalId);
  writeAppLog({
    scope: "main.ai",
    message: "AI 命令授权已拒绝",
    data: {
      tabId: approval.input.tabId,
      command: approval.command,
    },
  });

  return true;
}
