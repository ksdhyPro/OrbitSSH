import type {
  AiChatInput,
  AiContextUsage,
  AiMessage,
} from "../../shared/ai.js";
import type { ExecutedAiCommandContext } from "./ai-context.js";

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: "provider" | "estimated";
}

export interface AiConversationMemory {
  summary: string;
  commands: ExecutedAiCommandContext[];
}

interface AiConversationContextState extends AiConversationMemory {
  tabId: string;
  historyFloorCreatedAt: number;
  lastUsage?: AiTokenUsage;
  lastUsageConfigId?: string;
  compressionFailed: boolean;
}

const contextUsageThreshold = 0.8;
const compressionRequestSafetyThreshold = 0.95;
const summaryHistoryRatio = 0.2;
export const MIN_AI_SUMMARY_TOKENS = 512;
const estimatedFixedRequestTokens = 2_000;
const estimatedSummaryPromptTokens = 300;

/** 使用固定中间值粗算 Token：两个字符约等于一个 Token。 */
export function estimateTokenCount(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil(text.length / 2);
}

export function getContextThresholdTokens(contextTokenLimitK: number): number {
  return Math.floor(contextTokenLimitK * 1_000 * contextUsageThreshold);
}

export function isContextBudgetReached(
  contextTokenLimitK: number,
  estimatedRequestTokens: number,
  lastUsage?: AiTokenUsage,
): boolean {
  if (!Number.isSafeInteger(contextTokenLimitK) || contextTokenLimitK <= 0) {
    return false;
  }

  const threshold = getContextThresholdTokens(contextTokenLimitK);
  return estimatedRequestTokens >= threshold || (lastUsage?.totalTokens ?? 0) >= threshold;
}

export function isContextWindowExceededError(
  status: number,
  responseText: string,
): boolean {
  return status === 413 ||
    /context[_ -]?length[_ -]?exceeded|maximum context length|context window|too many tokens/i.test(
      responseText,
    );
}

/** 根据历史规模、压缩请求安全线和新上下文剩余空间动态计算摘要输出上限。 */
export function calculateSummaryMaxTokens(
  input: AiChatInput,
  memory: AiConversationMemory,
  contextTokenLimitK: number,
): number {
  if (!Number.isSafeInteger(contextTokenLimitK) || contextTokenLimitK <= 0) {
    return 0;
  }

  const totalTokens = contextTokenLimitK * 1_000;
  const normalHistoryTokens = estimateTokenCount(input.history);
  const compressionPromptTokens =
    estimatedSummaryPromptTokens +
    estimateTokenCount(memory.summary) +
    normalHistoryTokens;
  const newContextFixedTokens =
    estimatedFixedRequestTokens +
    estimateTokenCount({
      commands: memory.commands,
      message: input.message,
      context: input.context,
      presetPrompt: input.presetPrompt ?? "",
    });
  const summaryMaxTokens = Math.floor(Math.min(
    normalHistoryTokens * summaryHistoryRatio,
    totalTokens * compressionRequestSafetyThreshold - compressionPromptTokens,
    totalTokens * contextUsageThreshold - newContextFixedTokens,
  ));

  return summaryMaxTokens >= MIN_AI_SUMMARY_TOKENS ? summaryMaxTokens : 0;
}

function cloneRememberedCommand(command: ExecutedAiCommandContext): ExecutedAiCommandContext {
  return {
    ...command,
    // SSH 执行层已经限制单次输出大小；这里完整保留指令回复供后续上下文段使用。
    result: { ...command.result },
  };
}

export class AiConversationContextManager {
  private readonly states = new Map<string, AiConversationContextState>();

  getMemory(input: Pick<AiChatInput, "tabId" | "conversationId">): AiConversationMemory {
    const state = this.getState(input);
    return {
      summary: state.summary,
      commands: state.commands.map(command => cloneRememberedCommand(command)),
    };
  }

  getSegmentHistory(input: AiChatInput): AiMessage[] {
    const floor = this.getState(input).historyFloorCreatedAt;
    return floor > 0
      ? input.history.filter(message => message.createdAt > floor)
      : input.history;
  }

  assertAvailable(input: Pick<AiChatInput, "tabId" | "conversationId">): void {
    if (this.getState(input).compressionFailed) {
      throw new Error("上下文压缩失败，本对话已停止继续请求模型。请新建对话后重试。");
    }
  }

  shouldCompress(
    input: AiChatInput,
    contextTokenLimitK: number,
    configId: string,
  ): boolean {
    const state = this.getState(input);
    const estimatedRequestTokens = estimatedFixedRequestTokens + estimateTokenCount({
      summary: state.summary,
      commands: state.commands,
      history: this.getSegmentHistory(input),
      message: input.message,
      context: input.context,
      presetPrompt: input.presetPrompt ?? "",
    });

    return isContextBudgetReached(
      contextTokenLimitK,
      estimatedRequestTokens,
      state.lastUsageConfigId === configId ? state.lastUsage : undefined,
    );
  }

  recordUsage(
    input: Pick<AiChatInput, "tabId" | "conversationId">,
    usage: AiTokenUsage,
    configId: string,
  ): void {
    const state = this.getState(input);
    state.lastUsage = usage;
    state.lastUsageConfigId = configId;
  }

  getContextUsage(
    input: Pick<AiChatInput, "tabId" | "conversationId">,
    configId: string,
    contextTokenLimitK: number,
  ): AiContextUsage | undefined {
    if (!Number.isSafeInteger(contextTokenLimitK) || contextTokenLimitK <= 0) {
      return undefined;
    }

    const state = this.getState(input);
    const maxTokens = contextTokenLimitK * 1_000;
    const usage = state.lastUsageConfigId === configId
      ? state.lastUsage
      : undefined;
    const usedTokens = Math.max(0, usage?.totalTokens ?? 0);
    return {
      configId,
      usedTokens,
      maxTokens,
      percent: Math.min(100, usedTokens / maxTokens * 100),
      source: usage?.source ?? "estimated",
    };
  }

  recordCommand(
    input: Pick<AiChatInput, "tabId" | "conversationId">,
    command: ExecutedAiCommandContext,
  ): void {
    const state = this.getState(input);
    if (state.commands.some(item => item.toolCallId === command.toolCallId)) return;
    state.commands.push(cloneRememberedCommand(command));
  }

  completeCompression(input: AiChatInput, summary: string): void {
    const state = this.getState(input);
    state.summary = summary.trim();
    state.historyFloorCreatedAt = input.history.reduce(
      (latest, message) => Math.max(latest, message.createdAt),
      state.historyFloorCreatedAt,
    );
    state.lastUsage = undefined;
    state.lastUsageConfigId = undefined;
    state.compressionFailed = false;
  }

  failCompression(input: Pick<AiChatInput, "tabId" | "conversationId">): void {
    this.getState(input).compressionFailed = true;
  }

  clearTab(tabId: string): void {
    for (const [conversationId, state] of this.states) {
      if (state.tabId === tabId) this.states.delete(conversationId);
    }
  }

  private getState(
    input: Pick<AiChatInput, "tabId" | "conversationId">,
  ): AiConversationContextState {
    const existing = this.states.get(input.conversationId);
    if (existing) {
      if (existing.tabId !== input.tabId) {
        throw new Error("AI 对话与终端标签页不匹配");
      }
      return existing;
    }

    const state: AiConversationContextState = {
      tabId: input.tabId,
      summary: "",
      commands: [],
      historyFloorCreatedAt: 0,
      compressionFailed: false,
    };
    this.states.set(input.conversationId, state);
    return state;
  }
}
