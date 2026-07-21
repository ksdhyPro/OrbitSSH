import { AI_ATTACHMENT_CHUNK_MAX_BYTES } from "../../shared/ai.js";
import type {
  AiAttachmentReadResult,
  AiChatInput,
} from "../../shared/ai.js";
import type {
  AppSettings,
} from "../../shared/settings.js";
import { writeAppLog } from "../logger.js";
import { getTerminalContextSnapshot } from "../ssh/session-manager.js";
import {
  buildAiMessages,
  truncateText,
  type ExecutedAiCommandContext,
  type LocalPolicyRejectionFeedback,
} from "./ai-context.js";
import {
  collectAiApiStream,
  parseAttachmentReadToolCalls,
  parseAiApiResponsePayload,
  parseRunShellToolCalls,
  type ParsedAssistantResponse,
  type RawToolCall,
} from "./ai-response-parser.js";
import {
  createAiApiRequest,
  type AiApiTool,
} from "./ai-api-adapter.js";
import { getActiveAiConfig } from "./ai-model-selection.js";
import {
  getAiRetryDelayMs,
  isRetryableAiNetworkError,
  isRetryableAiStatus,
  maxAiResponseAttempts,
  waitForAiRetry,
} from "./ai-retry.js";

export type {
  ParsedAiCommand,
  ParsedAssistantResponse,
} from "./ai-response-parser.js";

const aiProviderLabels: Record<string, string> = {
  deepseek: "DeepSeek",
  glm: "GLM",
  other: "其他",
};

const runShellTool: AiApiTool = {
  type: "function",
  function: {
      name: "run_shell_command",
      description: "在当前标签页对应的终端会话中执行一条 Shell 命令；命令和输出会显示在该终端，用于查看系统状态、日志、文件、进程等。",
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
};

const readAttachmentChunkTool: AiApiTool = {
  type: "function",
  function: {
    name: "read_attachment_chunk",
    description:
      "按字节偏移读取用户上传的大型文本、代码、配置或日志附件。只读取解决当前问题所需的片段，并使用返回的 nextOffset 继续读取。",
    parameters: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description: "附件清单中显示的附件 ID",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "从 0 开始的字节偏移；继续读取时使用上次返回的 nextOffset",
        },
        max_bytes: {
          type: "integer",
          minimum: 1,
          maximum: AI_ATTACHMENT_CHUNK_MAX_BYTES,
          description: `本次最多读取的字节数，最大 ${AI_ATTACHMENT_CHUNK_MAX_BYTES}`,
        },
      },
      required: ["attachment_id", "offset", "max_bytes"],
      additionalProperties: false,
    },
    strict: true,
  },
};

function createAiTools(input: AiChatInput): AiApiTool[] {
  const tools = [runShellTool];
  if (
    input.attachments?.some(attachment => attachment.delivery === "chunked")
  ) {
    tools.push(readAttachmentChunkTool);
  }
  return tools;
}

// 异常响应只保留有限长度，避免单次模型响应撑大应用日志文件。
const maxLoggedRawResponseChars = 12_000;

type AiTurnAttemptResult = ParsedAssistantResponse & {
  // 仅供请求层判断是否需要重试，不向渲染层暴露。
  retryable?: boolean;
};

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  return getErrorCode(record.cause);
}

function getRawResponsePreview(rawResponseText: string): string {
  if (!rawResponseText) return "";
  return truncateText(rawResponseText, maxLoggedRawResponseChars);
}

function summarizeToolCalls(rawToolCalls: RawToolCall[]) {
  return rawToolCalls.map(toolCall => ({
    name: toolCall.function?.name ?? "",
    argumentsLength:
      typeof toolCall.function?.arguments === "string"
        ? toolCall.function.arguments.length
        : JSON.stringify(toolCall.function?.arguments ?? null).length,
  }));
}

function createAiRequestErrorResponse(error: unknown): AiTurnAttemptResult {
  if (error instanceof Error && error.message === "AI_RESPONSE_TOO_LARGE") {
    return { reply: "AI 服务响应过大，已停止接收。", commands: [], retryable: false };
  }
  if (getErrorCode(error) === "UND_ERR_CONNECT_TIMEOUT") {
    return {
      reply: "无法连接 AI 服务：连接超时。请检查网络、代理或防火墙设置后重试。",
      commands: [],
      retryable: true,
    };
  }
  return {
    reply: "无法连接 AI 服务。请检查网络、代理配置或稍后重试。",
    commands: [],
    retryable: true,
  };
}

async function createAiStatusErrorResponse(
  response: Response,
  responseText?: string,
): Promise<AiTurnAttemptResult> {
  const text = responseText ?? (await response.text().catch(() => ""));
  const detail = text ? `，返回信息：${truncateText(text, 300)}` : "";
  return {
    reply: `AI 请求失败（HTTP ${response.status}）${detail}`,
    commands: [],
    retryable: true,
  };
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

async function requestAiTurnOnce(
  input: AiChatInput,
  settings: AppSettings,
  executedCommands: ExecutedAiCommandContext[],
  signal?: AbortSignal,
  sendChunk?: (text: string) => void,
  policyFeedback?: LocalPolicyRejectionFeedback,
  attachmentReads: AiAttachmentReadResult[] = [],
): Promise<AiTurnAttemptResult> {
  const terminalOutput = settings.ai.shareTerminalContext
    ? (getTerminalContextSnapshot(input.tabId)?.recentOutput ?? "")
    : "";
  const activeConfig = getActiveAiConfig(settings, input);
  if (!activeConfig) {
    return {
      reply: input.attachments?.length
        ? "当前模型不支持附件输入，请在 AI 设置中选择支持图片或文件的多模态模型。"
        : createLocalFallback(input, executedCommands).reply,
      commands: [],
    };
  }

  const providerName =
    aiProviderLabels[activeConfig.provider] || activeConfig.providerName || activeConfig.name;
  let rawResponseText = "";
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
    const apiRequest = createAiApiRequest(
      activeConfig,
      buildAiMessages(
        input,
        executedCommands,
        terminalOutput,
        policyFeedback,
        activeConfig.contextWindow,
        activeConfig.maxOutputTokens,
        attachmentReads,
      ),
      createAiTools(input),
      activeConfig.maxOutputTokens,
      Boolean(sendChunk),
      true,
    );
    const response = await fetch(apiRequest.url, {
      method: "POST",
      headers: apiRequest.headers,
      body: JSON.stringify(apiRequest.body),
      signal,
    });
    if (!response.ok) {
      rawResponseText = await response.text().catch(() => "");
      writeAppLog({
        scope: "main.ai",
        level: "error",
        message: "AI 响应异常",
        data: {
          provider: providerName,
          tabId: input.tabId,
          status: response.status,
          rawResponse: getRawResponsePreview(rawResponseText),
        },
      });
      const statusError = await createAiStatusErrorResponse(response, rawResponseText);
      statusError.retryable = isRetryableAiStatus(response.status);
      return statusError;
    }

    let reply = "";
    let normalizedToolCalls: RawToolCall[] = [];
    if (sendChunk && response.body) {
      const streamed = await collectAiApiStream(activeConfig.spec, response.body, sendChunk);
      reply = streamed.contentText;
      rawResponseText = streamed.rawResponseText;
      normalizedToolCalls = streamed.toolCalls.map(toolCall => ({
        id: toolCall.id,
        type: "function",
        function: { name: toolCall.name, arguments: toolCall.arguments },
      }));
      if (!reply && normalizedToolCalls.length === 0 && rawResponseText.trim().startsWith("{")) {
        const parsed = parseAiApiResponsePayload(
          activeConfig.spec,
          JSON.parse(rawResponseText) as Record<string, unknown>,
        );
        reply = parsed.contentText;
        normalizedToolCalls = parsed.toolCalls;
        if (reply) sendChunk(reply);
      }
    } else {
      rawResponseText = await response.text();
      const payload = JSON.parse(rawResponseText) as Record<string, unknown>;
      const parsed = parseAiApiResponsePayload(activeConfig.spec, payload);
      reply = parsed.contentText;
      normalizedToolCalls = parsed.toolCalls;
    }

    const commands = parseRunShellToolCalls(normalizedToolCalls);
    const parsedAttachmentReads = parseAttachmentReadToolCalls(normalizedToolCalls);
    let retryable = false;
    if (
      normalizedToolCalls.length > 0 &&
      commands.length === 0 &&
      parsedAttachmentReads.length === 0
    ) {
      retryable = true;
      writeAppLog({
        scope: "main.ai",
        level: "warn",
        message: "AI 工具调用名称或参数无效",
        data: {
          provider: providerName,
          tabId: input.tabId,
          toolCalls: summarizeToolCalls(normalizedToolCalls),
          rawResponse: getRawResponsePreview(rawResponseText),
        },
      });
    }
    if (!reply.trim() && normalizedToolCalls.length === 0) {
      retryable = true;
      writeAppLog({
        scope: "main.ai",
        level: "warn",
        message: "AI 返回空回复",
        data: {
          provider: providerName,
          tabId: input.tabId,
          streaming: Boolean(sendChunk),
          rawResponse: getRawResponsePreview(rawResponseText),
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
        hasAttachmentReads: parsedAttachmentReads.length > 0,
      },
    });
    return {
      reply,
      commands,
      attachmentReads: parsedAttachmentReads,
      retryable,
    };
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
        rawResponse: getRawResponsePreview(rawResponseText),
      },
    });
    const requestError = createAiRequestErrorResponse(error);
    if (
      (error instanceof Error && error.message === "AI_RESPONSE_TOO_LARGE") ||
      !isRetryableAiNetworkError(error)
    ) {
      requestError.retryable = false;
    }
    return requestError;
  }
}

/**
 * 请求异常时使用指数退避自动重试；合法工具调用的空文本回复不属于异常。
 * 重试次数耗尽后将结果交给上层，由现有逻辑通知用户。
 */
export async function requestAiTurn(
  input: AiChatInput,
  settings: AppSettings,
  executedCommands: ExecutedAiCommandContext[],
  signal?: AbortSignal,
  sendChunk?: (text: string) => void,
  policyFeedback?: LocalPolicyRejectionFeedback,
  attachmentReads: AiAttachmentReadResult[] = [],
): Promise<ParsedAssistantResponse> {
  let attempt = 1;
  let result = await requestAiTurnOnce(
    input,
    settings,
    executedCommands,
    signal,
    sendChunk,
    policyFeedback,
    attachmentReads,
  );

  while (result.retryable && attempt < maxAiResponseAttempts && !signal?.aborted) {
    const delayMs = getAiRetryDelayMs(attempt);
    writeAppLog({
      scope: "main.ai",
      level: "warn",
      message: "AI 响应异常，正在自动重试",
      data: {
        tabId: input.tabId,
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
      },
    });
    if (!(await waitForAiRetry(delayMs, signal))) break;
    attempt += 1;
    result = await requestAiTurnOnce(
      input,
      settings,
      executedCommands,
      signal,
      sendChunk,
      policyFeedback,
      attachmentReads,
    );
  }

  return {
    reply: result.reply,
    commands: result.commands,
    attachmentReads: result.attachmentReads,
  };
}
