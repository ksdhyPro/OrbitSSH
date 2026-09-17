import type {
  AiChatInput,
  AiChatResult,
  AiCommandCard,
  AiConversationRecord,
  AiMessage,
} from "../../shared/ai.js";
import {
  getConversationRecord,
  getConversationRuntimeContext,
  saveConversation,
  saveConversationRuntimeContext,
} from "../storage/ai-conversation-store.js";
import { writeAppLog } from "../logger.js";
import type { AiConversationContextManager } from "./ai-context-budget.js";

function mergeMessages(previous: AiMessage[], next: AiMessage[]): AiMessage[] {
  const byId = new Map(previous.map(message => [message.id, message]));
  next.forEach(message => byId.set(message.id, message));
  return Array.from(byId.values()).sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}

function mergeCards(
  previous: AiCommandCard[],
  next: AiCommandCard[],
): AiCommandCard[] {
  const byId = new Map(previous.map(card => [card.id, card]));
  next.forEach(card => byId.set(card.id, card));
  return Array.from(byId.values()).sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}

function createRecord(input: AiChatInput): AiConversationRecord {
  return {
    id: input.conversationId,
    title: input.conversationTitle,
    presetPrompt: input.presetPrompt,
    messages: input.history,
    commandCards: [],
    createdAt: input.conversationCreatedAt,
    updatedAt: input.messageCreatedAt,
  };
}

function getRecord(input: AiChatInput): AiConversationRecord {
  return getConversationRecord(
    input.context.serverId,
    input.conversationId,
  ) ?? createRecord(input);
}

function safelyUpdateConversationState(
  input: AiChatInput,
  operation: string,
  update: () => void,
): void {
  try {
    update();
  } catch (error) {
    // 持久化失败不能改变已经发生的命令执行结果或中断当前 Agent 流程。
    writeAppLog({
      scope: "main.ai",
      level: "error",
      message: `AI 对话${operation}失败`,
      data: {
        serverId: input.context.serverId,
        conversationId: input.conversationId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** 请求开始即写入用户消息，异常退出时也能恢复用户已发送的内容。 */
export function beginPersistedAiTurn(input: AiChatInput): void {
  safelyUpdateConversationState(input, "开始写入", () => {
    const record = getRecord(input);
    const userMessage: AiMessage = {
      id: input.messageId,
      role: "user",
      content: input.message,
      createdAt: input.messageCreatedAt,
    };
    saveConversation({
      serverId: input.context.serverId,
      conversation: {
        ...record,
        title: record.title === "新对话" ? input.conversationTitle : record.title,
        presetPrompt: record.presetPrompt || input.presetPrompt,
        messages: mergeMessages(record.messages, [...input.history, userMessage]),
        updatedAt: Date.now(),
      },
    });
  });
}

/** 主进程合并 Agent 返回内容并落盘，Renderer 只消费结果。 */
export function completePersistedAiTurn(
  input: AiChatInput,
  result: AiChatResult,
): void {
  safelyUpdateConversationState(input, "结果写入", () => {
    const record = getRecord(input);
    saveConversation({
      serverId: input.context.serverId,
      conversation: {
        ...record,
        messages: mergeMessages(record.messages, result.messages),
        commandCards: mergeCards(record.commandCards, result.commandCards),
        contextUsage: result.contextUsage ?? record.contextUsage,
        updatedAt: Date.now(),
      },
    });
  });
}

export function updatePersistedAiCommandCard(
  input: AiChatInput,
  card: AiCommandCard,
): void {
  safelyUpdateConversationState(input, "命令卡写入", () => {
    const record = getRecord(input);
    saveConversation({
      serverId: input.context.serverId,
      conversation: {
        ...record,
        commandCards: mergeCards(record.commandCards, [card]),
        updatedAt: Date.now(),
      },
    });
  });
}

/** 首次访问会话时恢复压缩摘要和工具执行记忆。 */
export function restoreAiConversationContext(
  input: AiChatInput,
  contexts: AiConversationContextManager,
): void {
  safelyUpdateConversationState(input, "上下文恢复", () => {
    contexts.restore(
      input,
      getConversationRuntimeContext(
        input.context.serverId,
        input.conversationId,
      ),
    );
  });
}

export function persistAiConversationContext(
  input: AiChatInput,
  contexts: AiConversationContextManager,
): void {
  safelyUpdateConversationState(input, "上下文写入", () => {
    saveConversationRuntimeContext(
      input.context.serverId,
      input.conversationId,
      contexts.snapshot(input),
    );
  });
}
