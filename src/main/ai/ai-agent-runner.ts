import type {
  AiChatInput,
  AiChatResult,
  AiCommandCard,
  AiMessage,
} from "../../shared/ai.js";
import type { AppSettings } from "../../shared/settings.js";
import {
  createPolicyRejectionFeedback,
  createAssistantMessage,
  emitRejectedAction,
  executeAgentAction,
  getNextAgentAction,
  type PendingApprovalState,
} from "./ai-agent-actions.js";
import type { AgentEmitter } from "./ai-agent-events.js";
import type {
  AiConversationMemory,
  AiTokenUsage,
} from "./ai-context-budget.js";
import type {
  AiLongCommandProgressContext,
  ExecutedAiCommandContext,
  LocalPolicyRejectionFeedback,
} from "./ai-context.js";
import { getAiExecutionStopReason } from "./ai-execution-budget.js";
import { requestAiTurn } from "./ai-provider.js";

const maxLocalPolicyRetries = 3;

export interface RunAgentLoopOptions {
  input: AiChatInput;
  settings: AppSettings;
  signal: AbortSignal;
  emit?: AgentEmitter;
  previousCards?: AiCommandCard[];
  initialExecutedCommands?: ExecutedAiCommandContext[];
  storeApproval: (approvalId: string, state: PendingApprovalState) => void;
  memory?: AiConversationMemory;
  prepareContext?: (
    messages: AiMessage[],
    executedCommands: ExecutedAiCommandContext[],
  ) => Promise<{ input: AiChatInput; memory: AiConversationMemory }>;
  onTokenUsage?: (usage: AiTokenUsage) => void;
  onCommandExecuted?: (command: ExecutedAiCommandContext) => void;
}

export class AiContextWindowExceededError extends Error {
  constructor(
    readonly messages: AiMessage[],
    readonly commandCards: AiCommandCard[],
    readonly executedCommands: ExecutedAiCommandContext[],
  ) {
    super("模型上下文窗口已达到上限");
    this.name = "AiContextWindowExceededError";
  }
}

export interface ReportLongCommandProgressOptions {
  input: AiChatInput;
  settings: AppSettings;
  signal: AbortSignal;
  progress: AiLongCommandProgressContext;
  messages: AiMessage[];
  executedCommands: ExecutedAiCommandContext[];
  emit?: AgentEmitter;
  memory?: AiConversationMemory;
  onTokenUsage?: (usage: AiTokenUsage) => void;
}

/** 请求模型把长命令增量输出转换成简短进度，并立即推送到当前对话。 */
export async function reportLongCommandProgress(
  options: ReportLongCommandProgressOptions,
): Promise<void> {
  const parsed = await requestAiTurn(
    options.input,
    options.settings,
    options.executedCommands,
    options.signal,
    undefined,
    undefined,
    options.memory,
    options.progress,
  );
  if (options.signal.aborted) return;
  if (parsed.usage) options.onTokenUsage?.(parsed.usage);

  const content = parsed.progressReports?.[0]?.message || (
    options.progress.outputChanged
      ? "长命令仍在执行，已收到新的运行输出。"
      : "长命令仍在执行中。"
  );
  const message = createAssistantMessage(content);
  options.messages.push(message);
  options.emit?.sendMessageStart(message.id, message.createdAt);
  options.emit?.sendChunk(message.id, message.content);
}

/** 运行单个 AI 请求的模型—动作循环，直到完成、审批暂停或预算耗尽。 */
export async function runAgentLoop(
  options: RunAgentLoopOptions,
): Promise<AiChatResult> {
  const { input, settings, signal, emit, storeApproval } = options;
  const messages: AiMessage[] = [];
  let budgetStartedAt = Date.now();
  let commandCards = [...(options.previousCards ?? [])];
  let executedCommands = [...(options.initialExecutedCommands ?? [])];
  let policyFeedback: LocalPolicyRejectionFeedback | undefined;
  let localPolicyRetryCount = 0;

  while (true) {
    if (signal.aborted) {
      messages.push(createAssistantMessage("[已终止]"));
      return { messages, commandCards };
    }

    const stopReason = getAiExecutionStopReason(executedCommands, budgetStartedAt);
    if (stopReason) {
      messages.push(
        createAssistantMessage(
          `${stopReason}\n\n已完成 ${executedCommands.length} 条命令检查。请根据当前结果继续提问，或提供新的排查方向。`,
        ),
      );
      return { messages, commandCards };
    }

    const messageId = crypto.randomUUID();
    const messageCreatedAt = Date.now() + 1;
    emit?.sendMessageStart(messageId, messageCreatedAt);
    const preparedContext = await options.prepareContext?.(
      messages,
      executedCommands,
    );
    const parsed = await requestAiTurn(
      preparedContext?.input ?? input,
      settings,
      executedCommands,
      signal,
      emit ? text => emit.sendChunk(messageId, text) : undefined,
      policyFeedback,
      preparedContext?.memory ?? options.memory,
    );
    if (parsed.contextLimitExceeded) {
      throw new AiContextWindowExceededError(
        messages,
        commandCards,
        executedCommands,
      );
    }
    if (parsed.usage) options.onTokenUsage?.(parsed.usage);
    const reply = parsed.reply?.trim();
    const action = getNextAgentAction(parsed);
    const defaultMessage = action
      ? action.type === "saved_server"
        ? `查看已保存服务器：${action.serverName}（${action.reason}）`
        : `执行：${action.command}（${action.reason}）`
      : "未收到有效回复。";

    // 保持原有语义：当前服务器的格式拒绝会反馈给模型并允许修正。
    if (
      action &&
      action.type !== "saved_server" &&
      action.policy.decision === "deny"
    ) {
      commandCards = emitRejectedAction(input, action, commandCards, emit);
      if (localPolicyRetryCount < maxLocalPolicyRetries) {
        localPolicyRetryCount += 1;
        policyFeedback = createPolicyRejectionFeedback(
          action,
          localPolicyRetryCount,
          maxLocalPolicyRetries,
        );
        messages.push({
          id: messageId,
          role: "assistant",
          content: `${reply || defaultMessage}\n\n本地策略已拦截：${action.policy.reason}。正在请求模型第 ${localPolicyRetryCount}/${maxLocalPolicyRetries} 次修正。`,
          createdAt: messageCreatedAt,
        });
        continue;
      }

      messages.push({
        id: messageId,
        role: "assistant",
        content: `${reply || defaultMessage}\n\n本地策略重试已耗尽，该命令不可通过审批绕过。请修改需求或明确提供其他安全排查方向。`,
        createdAt: messageCreatedAt,
      });
      return { messages, commandCards };
    }

    policyFeedback = undefined;
    localPolicyRetryCount = 0;
    messages.push({
      id: messageId,
      role: "assistant",
      content: reply || defaultMessage,
      createdAt: messageCreatedAt,
    });
    if (!action) return { messages, commandCards };

    const actionStartedAt = Date.now();
    const execution = await executeAgentAction({
      input,
      signal,
      emit,
      action,
      commandCards,
      executedCommands,
      messages,
      storeApproval,
      onCommandExecuted: options.onCommandExecuted,
      onLongCommandProgress: (progress, progressSignal) =>
        reportLongCommandProgress({
          input,
          settings,
          signal: progressSignal,
          progress,
          messages,
          executedCommands,
          emit,
          memory: preparedContext?.memory ?? options.memory,
          onTokenUsage: options.onTokenUsage,
        }),
    });
    if (action.type === "long_shell") {
      // 长命令等待不占用普通 Agent 的十分钟推理预算。
      budgetStartedAt += Date.now() - actionStartedAt;
    }
    if (execution.status === "return") return execution.result;
    commandCards = execution.commandCards;
    executedCommands = execution.executedCommands;
  }
}
