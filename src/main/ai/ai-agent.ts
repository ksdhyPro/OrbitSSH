import type {
  AiApprovedCommandInput,
  AiChatInput,
  AiChatResult,
  AiCommandCard,
  AiCommandResult,
  AiMessage,
  AiRejectedCommandInput,
} from "../../shared/ai.js";
import type { AiProvider, AppSettings } from "../../shared/settings.js";
import { writeAppLog } from "../logger.js";
import { executeTerminalCommand } from "../ssh/session-manager.js";
import { getTerminalContextSnapshot } from "../ssh/session-manager.js";
import {
  evaluateAiCommand,
  isReadonlyAllowedCommand,
  requiresMandatoryApproval,
} from "./command-policy.js";

interface AiProviderConfig {
  name: string;
  baseUrl: string;
  chatCompletionsPath: string;
}

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

const aiProviderConfigs: Record<AiProvider, AiProviderConfig> = {
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    chatCompletionsPath: "/chat/completions",
  },
};

const maxAgentCommandCount = 6;
const approvalTtlMs = 5 * 60 * 1000;
const pendingApprovals = new Map<string, PendingApprovalState>();

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
        `输出：\n${truncateText(output || "无输出", 1800)}`,
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
    "只能返回严格 JSON，不要返回 Markdown 或额外说明，结构如下：",
    '{"reply":"简短、有帮助的中文回答","commands":[{"command":"...","reason":"中文说明","risk":"low|medium|high"}]}',
    "每次最多返回一条下一步命令，除非已经可以回答用户问题。",
    "如果已有命令结果足够回答用户问题，commands 必须返回空数组，并在 reply 里总结结论。",
    "如果还需要继续检查，请在 commands 数组里返回下一条命令。",
    "涉及写入、重启、删除、权限提升或其他高风险操作时，risk 必须标记为 high。",
    "模式说明：ask 表示每条命令都需要用户批准；auto 表示只读白名单命令可自动执行，其他命令需批准；full 表示除必须批准或 high 风险命令外可自动执行。",
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

function buildAiMessages(input: AiChatInput, systemPrompt: string): Array<{
  role: "system" | "assistant" | "user";
  content: string;
}> {
  return [
    { role: "system", content: systemPrompt },
    ...input.history.slice(-8).map(message => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      content: message.content,
    })),
    { role: "user", content: input.message },
  ];
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

function extractChatCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) {
    return "";
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return "";
  }

  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content.trim() : "";
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
      reply:
        "无法连接 AI 服务：连接超时。请检查网络、代理或防火墙设置后重试。",
      commands: [],
    };
  }

  return {
    reply:
      "无法连接 AI 服务。请检查网络、代理配置或稍后重试。",
    commands: [],
  };
}

async function createAiStatusErrorResponse(
  response: Response,
): Promise<ParsedAssistantResponse> {
  const responseText = await response.text().catch(() => "");
  const detail = responseText ? `，返回信息：${truncateText(responseText, 300)}` : "";

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
      commands: [{ command: "df -h", reason: "查看文件系统使用率", risk: "low" }],
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
    reply: "我可以根据当前服务器上下文给出建议；如果需要诊断，请描述现象或指定服务名。",
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
    risk: command.risk ?? (policy.decision === "allow_readonly" ? "low" : "medium"),
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
    return !isReadonlyAllowedCommand(command);
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

function mergeCards(previousCards: AiCommandCard[], nextCard: AiCommandCard): AiCommandCard[] {
  const index = previousCards.findIndex(card => card.id === nextCard.id);

  if (index < 0) {
    return [...previousCards, nextCard];
  }

  return previousCards.map(card => (card.id === nextCard.id ? nextCard : card));
}

async function requestAiTurn(
  input: AiChatInput,
  settings: AppSettings,
  executedCommands: ExecutedAiCommandContext[],
): Promise<ParsedAssistantResponse> {
  const snapshot = input.tabId
    ? getTerminalContextSnapshot(input.tabId)
    : undefined;
  const systemPrompt = buildSystemPrompt(
    input,
    snapshot?.recentOutput ?? "",
    executedCommands,
  );

  if (!settings.ai.enabled || !settings.ai.apiKey.trim()) {
    return createLocalFallback(input, executedCommands);
  }

  const providerConfig = aiProviderConfigs[settings.ai.provider];
  const requestUrl = `${providerConfig.baseUrl}${providerConfig.chatCompletionsPath}`;

  try {
    writeAppLog({
      scope: "main.ai",
      message: "AI 对话请求开始",
      data: {
        provider: providerConfig.name,
        model: settings.ai.model || "deepseek-chat",
        tabId: input.tabId,
        mode: input.mode,
        executedCommandCount: executedCommands.length,
      },
    });

    // 网络或代理异常不继续抛给 IPC，转成面板内可读提示。
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.ai.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.ai.model || "deepseek-chat",
        messages: buildAiMessages(input, systemPrompt),
      }),
    });

    if (!response.ok) {
      writeAppLog({
        scope: "main.ai",
        message: "AI 对话请求返回异常状态",
        data: {
          provider: providerConfig.name,
          status: response.status,
          tabId: input.tabId,
        },
      });
      return createAiStatusErrorResponse(response);
    }

    const payload = await response.json() as unknown;
    const parsed = parseAssistantResponse(
      extractChatCompletionText(payload) || extractOutputText(payload),
    );
    writeAppLog({
      scope: "main.ai",
      message: "AI 对话请求完成",
      data: {
        provider: providerConfig.name,
        tabId: input.tabId,
        hasCommands: Boolean(parsed.commands?.length),
      },
    });

    return parsed;
  } catch (error) {
    writeAppLog({
      scope: "main.ai",
      message: "AI 对话请求失败",
      data: {
        provider: providerConfig.name,
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
  previousCards: AiCommandCard[] = [],
  executedCommands: ExecutedAiCommandContext[] = [],
): Promise<AiChatResult> {
  const replies: string[] = [];
  let commandCards = [...previousCards];

  while (executedCommands.length < maxAgentCommandCount) {
    const parsed = await requestAiTurn(input, settings, executedCommands);
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

    if (shouldRequestApproval(input.mode, nextCommand.command, nextCommand.risk)) {
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
      const result = await executeTerminalCommand(input.tabId, nextCommand.command, 20_000);
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
): Promise<AiChatResult> {
  return runAgentLoop(input, settings);
}

export async function runApprovedAiCommand(
  input: AiApprovedCommandInput,
  settings: AppSettings,
): Promise<AiChatResult> {
  const approval = pendingApprovals.get(input.approvalId);

  if (!approval) {
    throw new Error("命令授权不存在或已过期");
  }

  if (Date.now() - approval.createdAt > approvalTtlMs) {
    pendingApprovals.delete(input.approvalId);
    throw new Error("命令授权已过期");
  }

  if (approval.input.tabId !== input.tabId || approval.command !== input.command.trim()) {
    throw new Error("命令授权与当前命令不匹配");
  }

  pendingApprovals.delete(input.approvalId);

  let commandCards = approval.previousCards;
  const executedCommands = [...approval.executedCommands];

  try {
    const result = await executeTerminalCommand(input.tabId, approval.command, 20_000);
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

    return runAgentLoop(approval.input, settings, commandCards, executedCommands);
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

export function rejectAiCommandApproval(input: AiRejectedCommandInput): boolean {
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
