import type { WebContents } from "electron";

import type {
  AiChatInput,
  AiCommandCard,
  AiCommandCardEvent,
  AiStreamChunkEvent,
  AiStreamMessageStartEvent,
} from "../../shared/ai.js";

/** Agent 对外事件接口，核心流程无需了解 Electron WebContents。 */
export interface AgentEmitter {
  sendMessageStart(messageId: string, createdAt: number): void;
  sendChunk(messageId: string, text: string): void;
  sendCommandCard(card: AiCommandCard): void;
}

/** 把 Agent 事件适配为 Renderer 可消费的 Electron IPC 事件。 */
export function createAgentEmitter(
  input: Pick<AiChatInput, "tabId" | "requestId" | "conversationId">,
  webContents?: WebContents,
): AgentEmitter | undefined {
  if (!webContents) return undefined;

  return {
    sendMessageStart: (messageId, createdAt) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-message-start", {
        tabId: input.tabId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        messageId,
        createdAt,
      } satisfies AiStreamMessageStartEvent);
    },
    sendChunk: (messageId, text) => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:stream-chunk", {
        tabId: input.tabId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        messageId,
        chunk: text,
      } satisfies AiStreamChunkEvent);
    },
    sendCommandCard: card => {
      if (webContents.isDestroyed()) return;
      webContents.send("ai:command-card", {
        tabId: input.tabId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        card,
      } satisfies AiCommandCardEvent);
    },
  };
}
