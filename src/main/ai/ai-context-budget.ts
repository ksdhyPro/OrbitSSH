import type { AiChatInput, AiContextUsage, AiMessage } from "../../shared/ai.js";
import {
  compactExecutedCommand,
  formatExecutedCommandForPrompt,
  type ExecutedAiCommandContext,
} from "./ai-context.js";
import type { AiPersistedConversationContext } from "../storage/ai-conversation-store.js";

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
// 工具调用 ID、名称和消息结构等每条命令固定开销。
const estimatedPerCommandTokens = 20;
// 命令记忆占模型窗口的比例：最近命令保留单条截断后的结果，更早的命令只保留末尾输出。
const commandMemoryFullRatio = 0.3;
const commandMemoryCompactedRatio = 0.1;
// 未配置上下文上限时，按常见的 32K 窗口估算命令记忆预算，仅在模型报告超限后使用。
const fallbackContextWindowTokens = 32_000;

// 主流分词器中，中日韩字符约 0.6～1 个 Token，英文、数字和代码约 3～4 个字符一个 Token，
// 制表符号、Emoji 等其他非 ASCII 字符通常单独占一个或更多 Token。取偏保守的中间值，
// 以十分之一 Token 为单位整数累加，避免浮点误差让整十字符多算一个 Token。
const asciiTenthTokensPerChar = 3;
const cjkTenthTokensPerChar = 7;
const otherTenthTokensPerChar = 10;

function isCjkCodeUnit(code: number): boolean {
  return (
    // 部首、全角标点、假名、注音和中日韩统一表意文字。
    (code >= 0x2e80 && code <= 0x9fff) ||
    // 韩文音节。
    (code >= 0xac00 && code <= 0xd7af) ||
    // 兼容表意文字。
    (code >= 0xf900 && code <= 0xfaff) ||
    // 全角与半角形式。
    (code >= 0xff00 && code <= 0xffef)
  );
}

/**
 * 按字符类别粗算 Token，区分中文与英文：命令输出多为英文，统一按两个字符一个 Token
 * 会把它高估一倍左右，导致上下文远未用满就触发压缩。
 */
export function estimateTokenCount(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  let asciiChars = 0;
  let cjkChars = 0;
  let otherChars = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) asciiChars += 1;
    else if (isCjkCodeUnit(code)) cjkChars += 1;
    else otherChars += 1;
  }
  return Math.ceil(
    (asciiChars * asciiTenthTokensPerChar +
      cjkChars * cjkTenthTokensPerChar +
      otherChars * otherTenthTokensPerChar) /
      10,
  );
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

/** 按实际发送给模型的截断后内容估算命令记忆，而不是按保存的原始输出。 */
export function estimateCommandMemoryTokens(commands: ExecutedAiCommandContext[]): number {
  return commands.reduce((total, command) => {
    const { toolArguments, toolResult } = formatExecutedCommandForPrompt(command);
    return (
      total +
      estimatedPerCommandTokens +
      estimateTokenCount(toolArguments) +
      estimateTokenCount(toolResult)
    );
  }, 0);
}

export interface AiCommandMemoryBudget {
  /** 保留单条截断后结果的最近命令可用 Token。 */
  fullTokens: number;
  /** 降级为末尾输出的较早命令可用 Token，超出后移除最早的命令。 */
  compactedTokens: number;
}

/**
 * 命令记忆预算按模型窗口比例计算。模型已经报告超限时说明窗口配置或估算有偏差，
 * aggressive 按一半预算降级，确保续接重试有足够空间。
 */
export function getCommandMemoryBudget(
  contextTokenLimitK: number,
  aggressive = false,
): AiCommandMemoryBudget {
  const windowTokens =
    Number.isSafeInteger(contextTokenLimitK) && contextTokenLimitK > 0
      ? contextTokenLimitK * 1_000
      : fallbackContextWindowTokens;
  const scale = aggressive ? 0.5 : 1;
  return {
    fullTokens: Math.floor(windowTokens * commandMemoryFullRatio * scale),
    compactedTokens: Math.floor(windowTokens * commandMemoryCompactedRatio * scale),
  };
}

/**
 * 从最新命令往前分配预算：先保留单条截断后的结果，用完后把更早的命令降级为末尾输出，
 * 再用完则移除更早的全部命令。已降级的命令不会恢复，压缩之间的请求前缀保持稳定。
 */
export function compactCommandMemory(
  commands: ExecutedAiCommandContext[],
  budget: AiCommandMemoryBudget,
): ExecutedAiCommandContext[] {
  const kept: ExecutedAiCommandContext[] = [];
  let phase: "full" | "compacted" = "full";
  let fullTokens = 0;
  let compactedTokens = 0;
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    let command = commands[index]!;
    if (phase === "full" && !command.compacted) {
      const tokens = estimateCommandMemoryTokens([command]);
      if (fullTokens + tokens <= budget.fullTokens) {
        fullTokens += tokens;
        kept.push(command);
        continue;
      }
    }
    phase = "compacted";
    command = compactExecutedCommand(command);
    const tokens = estimateCommandMemoryTokens([command]);
    if (compactedTokens + tokens > budget.compactedTokens) break;
    compactedTokens += tokens;
    kept.push(command);
  }
  return kept.reverse();
}

/** 历史太短时摘要额度达不到最小值，压缩也腾不出空间，应跳过摘要请求。 */
export function isHistoryTooShortToSummarize(history: AiMessage[]): boolean {
  return estimateTokenCount(history) * summaryHistoryRatio < MIN_AI_SUMMARY_TOKENS;
}

export function isContextWindowExceededError(status: number, responseText: string): boolean {
  return (
    status === 413 ||
    /context[_ -]?length[_ -]?exceeded|maximum context length|context window|too many tokens/i.test(
      responseText,
    )
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
    estimatedSummaryPromptTokens + estimateTokenCount(memory.summary) + normalHistoryTokens;
  const newContextFixedTokens =
    estimatedFixedRequestTokens +
    estimateCommandMemoryTokens(memory.commands) +
    estimateTokenCount({
      message: input.message,
      context: input.context,
      presetPrompt: input.presetPrompt ?? "",
    });
  const summaryMaxTokens = Math.floor(
    Math.min(
      normalHistoryTokens * summaryHistoryRatio,
      totalTokens * compressionRequestSafetyThreshold - compressionPromptTokens,
      totalTokens * contextUsageThreshold - newContextFixedTokens,
    ),
  );

  return summaryMaxTokens >= MIN_AI_SUMMARY_TOKENS ? summaryMaxTokens : 0;
}

function cloneRememberedCommand(command: ExecutedAiCommandContext): ExecutedAiCommandContext {
  return {
    ...command,
    // 保存执行层已限制大小的原始输出：发送时按单条上限截断，压缩时按预算降级。
    result: { ...command.result },
  };
}

export interface AiConversationContextManagerOptions {
  /** 内存中最多保留的对话状态数，超出后淘汰最久未使用的状态。 */
  maxStates?: number;
  /** 状态不在内存中时从持久化存储恢复，使淘汰不会丢失摘要和命令记忆。 */
  loadSnapshot?: (
    serverId: string,
    conversationId: string,
  ) => AiPersistedConversationContext | null;
}

const DEFAULT_MAX_CONVERSATION_STATES = 100;

export class AiConversationContextManager {
  private readonly states = new Map<string, AiConversationContextState>();
  private readonly maxStates: number;

  constructor(private readonly options: AiConversationContextManagerOptions = {}) {
    this.maxStates = options.maxStates ?? DEFAULT_MAX_CONVERSATION_STATES;
  }

  private getKey(input: Pick<AiChatInput, "conversationId" | "context">): string {
    return `${input.context.serverId}\u0000${input.conversationId}`;
  }

  /** 当前内存中的对话状态数量，用于观察缓存规模。 */
  get size(): number {
    return this.states.size;
  }

  restore(
    input: Pick<AiChatInput, "conversationId" | "context">,
    snapshot: AiPersistedConversationContext | null,
  ): void {
    const key = this.getKey(input);
    if (this.states.has(key) || !snapshot) return;
    this.states.set(key, {
      summary: snapshot.summary,
      commands: snapshot.commands.map(command => cloneRememberedCommand(command)),
      historyFloorCreatedAt: snapshot.historyFloorCreatedAt,
      compressionFailed: false,
    });
  }

  snapshot(input: Pick<AiChatInput, "conversationId" | "context">): AiPersistedConversationContext {
    const state = this.getState(input);
    return {
      summary: state.summary,
      commands: state.commands.map(command => cloneRememberedCommand(command)),
      historyFloorCreatedAt: state.historyFloorCreatedAt,
    };
  }

  getMemory(input: Pick<AiChatInput, "conversationId" | "context">): AiConversationMemory {
    const state = this.getState(input);
    return {
      summary: state.summary,
      commands: state.commands.map(command => cloneRememberedCommand(command)),
    };
  }

  getSegmentHistory(input: AiChatInput): AiMessage[] {
    const floor = this.getState(input).historyFloorCreatedAt;
    return floor > 0 ? input.history.filter(message => message.createdAt > floor) : input.history;
  }

  assertAvailable(input: Pick<AiChatInput, "conversationId" | "context">): void {
    if (this.getState(input).compressionFailed) {
      throw new Error("上下文压缩失败，本对话已停止继续请求模型。请新建对话后重试。");
    }
  }

  shouldCompress(input: AiChatInput, contextTokenLimitK: number, configId: string): boolean {
    const state = this.getState(input);
    const estimatedRequestTokens =
      estimatedFixedRequestTokens +
      estimateCommandMemoryTokens(state.commands) +
      estimateTokenCount({
        summary: state.summary,
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
    input: Pick<AiChatInput, "conversationId" | "context">,
    usage: AiTokenUsage,
    configId: string,
  ): void {
    const state = this.getState(input);
    state.lastUsage = usage;
    state.lastUsageConfigId = configId;
  }

  getContextUsage(
    input: Pick<AiChatInput, "conversationId" | "context">,
    configId: string,
    contextTokenLimitK: number,
  ): AiContextUsage | undefined {
    if (!Number.isSafeInteger(contextTokenLimitK) || contextTokenLimitK <= 0) {
      return undefined;
    }

    const state = this.getState(input);
    const maxTokens = contextTokenLimitK * 1_000;
    const usage = state.lastUsageConfigId === configId ? state.lastUsage : undefined;
    const usedTokens = Math.max(0, usage?.totalTokens ?? 0);
    return {
      configId,
      usedTokens,
      maxTokens,
      percent: Math.min(100, (usedTokens / maxTokens) * 100),
      source: usage?.source ?? "estimated",
    };
  }

  recordCommand(
    input: Pick<AiChatInput, "conversationId" | "context">,
    command: ExecutedAiCommandContext,
  ): void {
    const state = this.getState(input);
    if (state.commands.some(item => item.toolCallId === command.toolCallId)) return;
    state.commands.push(cloneRememberedCommand(command));
  }

  /**
   * 按预算降级命令记忆，返回是否发生变化。命令发生变化后上一次接口用量不再代表下一次请求，
   * 需要清除，避免旧用量继续触发压缩。
   */
  compactCommands(
    input: Pick<AiChatInput, "conversationId" | "context">,
    budget: AiCommandMemoryBudget,
  ): boolean {
    const state = this.getState(input);
    const commands = compactCommandMemory(state.commands, budget);
    const changed =
      commands.length !== state.commands.length ||
      commands.some((command, index) => command !== state.commands[index]);
    if (!changed) return false;
    state.commands = commands;
    state.lastUsage = undefined;
    state.lastUsageConfigId = undefined;
    return true;
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

  failCompression(input: Pick<AiChatInput, "conversationId" | "context">): void {
    this.getState(input).compressionFailed = true;
  }

  clearConversation(serverId: string, conversationId: string): void {
    this.states.delete(`${serverId}\u0000${conversationId}`);
  }

  /** 删除服务器时清理其全部对话状态。 */
  clearServer(serverId: string): void {
    const prefix = `${serverId}\u0000`;
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) this.states.delete(key);
    }
  }

  private getState(
    input: Pick<AiChatInput, "conversationId" | "context">,
  ): AiConversationContextState {
    const key = this.getKey(input);
    const existing = this.states.get(key);
    if (existing) {
      // 重新插入以维护最近使用顺序，Map 的迭代顺序即淘汰顺序。
      this.states.delete(key);
      this.states.set(key, existing);
      return existing;
    }

    const snapshot = this.loadSnapshot(input);
    const state: AiConversationContextState = {
      summary: snapshot?.summary ?? "",
      commands: snapshot?.commands.map(command => cloneRememberedCommand(command)) ?? [],
      historyFloorCreatedAt: snapshot?.historyFloorCreatedAt ?? 0,
      compressionFailed: false,
    };
    this.states.set(key, state);
    this.evictLeastRecentlyUsed();
    return state;
  }

  private loadSnapshot(
    input: Pick<AiChatInput, "conversationId" | "context">,
  ): AiPersistedConversationContext | null {
    try {
      return this.options.loadSnapshot?.(input.context.serverId, input.conversationId) ?? null;
    } catch {
      return null;
    }
  }

  private evictLeastRecentlyUsed(): void {
    while (this.states.size > this.maxStates) {
      const oldestKey = this.states.keys().next().value;
      if (oldestKey === undefined) return;
      this.states.delete(oldestKey);
    }
  }
}
