import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  AiCommandCard,
  AiContextInput,
  AiMessage,
  AiMode,
} from "../../shared/ai";
import { useCoreStore } from "./useCoreStore";
import { useSettingsStore } from "./useSettingsStore";

interface AiConversationState {
  id: string;
  title: string;
  messages: AiMessage[];
  commandCards: AiCommandCard[];
  createdAt: number;
  updatedAt: number;
}

interface AiTabSessionState {
  activeConversationId: string;
  conversations: AiConversationState[];
}

const HISTORY_LIMIT = 24;
const LONG_CONVERSATION_USER_MESSAGE_LIMIT = 12;
const LONG_CONVERSATION_COMMAND_CARD_LIMIT = 20;

function createMessage(role: AiMessage["role"], content: string): AiMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}

function createConversation(title = "新对话"): AiConversationState {
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    commandCards: [],
    createdAt: now,
    updatedAt: now,
  };
}

// IPC 只能传递可结构化克隆的数据，避免把 Vue 响应式 Proxy 传给主进程。
function toPlainAiContext(context: AiContextInput): AiContextInput {
  return {
    tabId: context.tabId || "",
    serverName: context.serverName,
    currentPath: context.currentPath,
    status: context.status,
    sftpPath: context.sftpPath,
  };
}

// 聊天历史来自响应式数组，发送前转成普通对象，避免 Electron IPC 克隆失败。
function toPlainAiHistory(history: AiMessage[]): AiMessage[] {
  return history.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    completedAt: message.completedAt,
  }));
}

export const useAiStore = defineStore("ai", () => {
  const core = useCoreStore();
  const settingsStore = useSettingsStore();

  const isPanelOpen = ref(true);
  const mode = ref<AiMode>(settingsStore.appSettings.ai.defaultMode);
  const inputText = ref("");
  const isSending = ref(false);
  const error = ref("");
  const activeTabId = ref("");
  const sessionsByTabId = ref<Record<string, AiTabSessionState>>({});

  const canUseAi = computed(() => settingsStore.appSettings.ai.enabled);
  const activeConversation = computed(() =>
    activeTabId.value ? getExistingActiveConversation(activeTabId.value) : null,
  );
  const messages = computed(() => activeConversation.value?.messages ?? []);
  const commandCards = computed(
    () => activeConversation.value?.commandCards ?? [],
  );
  const shouldSuggestNewConversation = computed(() => {
    const conversation = activeConversation.value;

    if (!conversation) {
      return false;
    }

    const userMessageCount = conversation.messages.filter(
      message => message.role === "user",
    ).length;

    return (
      userMessageCount >= LONG_CONVERSATION_USER_MESSAGE_LIMIT ||
      conversation.commandCards.length >= LONG_CONVERSATION_COMMAND_CARD_LIMIT
    );
  });

  function togglePanel(): void {
    isPanelOpen.value = !isPanelOpen.value;
  }

  function setMode(nextMode: AiMode): void {
    mode.value = nextMode;
  }

  function setActiveTabId(tabId: string): void {
    activeTabId.value = tabId;

    if (tabId) {
      getActiveConversation(tabId);
    }
  }

  // 每个终端标签页维护独立 AI 会话，避免不同服务器的历史互相污染。
  function getTabSession(tabId: string): AiTabSessionState {
    const existing = sessionsByTabId.value[tabId];

    if (existing) {
      return existing;
    }

    const conversation = createConversation();
    const session = {
      activeConversationId: conversation.id,
      conversations: [conversation],
    };

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: session,
    };

    return session;
  }

  function getActiveConversation(tabId: string): AiConversationState {
    const session = getTabSession(tabId);
    const active =
      session.conversations.find(
        conversation => conversation.id === session.activeConversationId,
      ) ?? session.conversations[0];

    if (active) {
      return active;
    }

    const conversation = createConversation();
    session.activeConversationId = conversation.id;
    session.conversations = [conversation];

    return conversation;
  }

  function getExistingActiveConversation(
    tabId: string,
  ): AiConversationState | null {
    const session = sessionsByTabId.value[tabId];

    if (!session) {
      return null;
    }

    return (
      session.conversations.find(
        conversation => conversation.id === session.activeConversationId,
      ) ??
      session.conversations[0] ??
      null
    );
  }

  function updateConversation(
    tabId: string,
    updater: (conversation: AiConversationState) => AiConversationState,
  ): void {
    const session = getTabSession(tabId);

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        ...session,
        conversations: session.conversations.map(conversation =>
          conversation.id === session.activeConversationId
            ? updater(conversation)
            : conversation,
        ),
      },
    };
  }

  function updateCommandCard(card: AiCommandCard): void {
    updateConversation(card.tabId, conversation => ({
      ...conversation,
      commandCards: conversation.commandCards.map(item =>
        item.id === card.id ? card : item,
      ),
      updatedAt: Date.now(),
    }));
  }

  function mergeCommandCards(
    tabId: string,
    cards: AiCommandCard[],
  ): void {
    updateConversation(tabId, conversation => {
      const nextCards = [...conversation.commandCards];

      for (const card of cards) {
        const index = nextCards.findIndex(item => item.id === card.id);

        if (index >= 0) {
          nextCards[index] = card;
        } else {
          nextCards.push(card);
        }
      }

      return {
        ...conversation,
        commandCards: nextCards,
        updatedAt: Date.now(),
      };
    });
  }

  function appendMessages(tabId: string, nextMessages: AiMessage[]): void {
    updateConversation(tabId, conversation => ({
      ...conversation,
      messages: [...conversation.messages, ...nextMessages],
      updatedAt: Date.now(),
    }));
  }

  function removeMessage(tabId: string, messageId: string): void {
    updateConversation(tabId, conversation => ({
      ...conversation,
      messages: conversation.messages.filter(message => message.id !== messageId),
      updatedAt: Date.now(),
    }));
  }

  function appendStreamChunk(
    tabId: string,
    messageId: string,
    chunk: string,
  ): void {
    updateConversation(tabId, conversation => ({
      ...conversation,
      messages: conversation.messages.map(message =>
        message.id === messageId
          ? { ...message, content: message.content + chunk }
          : message,
      ),
      updatedAt: Date.now(),
    }));
  }

  function hasBlockingCommandProcess(tabId: string): boolean {
    const conversation = getExistingActiveConversation(tabId);

    return Boolean(
      conversation?.commandCards.some(card =>
        ["requires_approval", "pending", "running"].includes(card.status),
      ),
    );
  }

  function startNewConversation(tabId = activeTabId.value): void {
    if (!tabId || isSending.value || hasBlockingCommandProcess(tabId)) {
      return;
    }

    const session = getTabSession(tabId);
    const conversation = createConversation();

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        activeConversationId: conversation.id,
        conversations: [...session.conversations, conversation],
      },
    };
    error.value = "";
  }

  function removeTabSession(tabId: string): void {
    if (!tabId) {
      return;
    }

    const nextSessions = { ...sessionsByTabId.value };
    delete nextSessions[tabId];
    sessionsByTabId.value = nextSessions;

    if (activeTabId.value === tabId) {
      activeTabId.value = "";
    }
  }

  // 注册本轮 agent loop 的三个流式事件监听器，返回 cleanup。
  // 主进程每轮开始推送 message-start → 前端插入空占位；
  // chunk 携带 messageId 累加到对应占位；命令卡片按 id upsert。
  function attachAiStreamListeners(
    tabId: string,
    activeStreamIds: Set<string>,
  ): () => void {
    const ai = core.orbitSSHApi?.ai;

    if (!ai?.onStreamMessageStart) {
      return () => {};
    }

    const removeStart = ai.onStreamMessageStart(event => {
      if (event.tabId !== tabId) return;
      activeStreamIds.add(event.messageId);
      appendMessages(tabId, [
        {
          id: event.messageId,
          role: "assistant",
          content: "",
          createdAt: event.createdAt,
        },
      ]);
    });
    const removeChunk = ai.onStreamChunk(event => {
      if (event.tabId !== tabId) return;
      appendStreamChunk(tabId, event.messageId, event.chunk);
    });
    const removeCard = ai.onCommandCard(event => {
      if (event.tabId !== tabId) return;
      mergeCommandCards(tabId, [event.card]);
    });

    return () => {
      removeStart();
      removeChunk();
      removeCard();
    };
  }

  // 对账：移除本轮所有流式占位消息，再用主进程返回的最终消息整体替换，
  // 避免流式累积与最终结果重复或残留空占位。
  function reconcileStreamMessages(
    tabId: string,
    activeStreamIds: Set<string>,
    finalMessages: AiMessage[],
  ): void {
    const completedAt = Date.now();
    const settledMessages = finalMessages.map(message => ({
      ...message,
      completedAt:
        message.role === "assistant"
          ? (message.completedAt ?? completedAt)
          : message.completedAt,
    }));

    for (const id of activeStreamIds) {
      removeMessage(tabId, id);
    }
    if (settledMessages.length > 0) {
      appendMessages(tabId, settledMessages);
    }
  }

  async function sendMessage(context: AiContextInput): Promise<void> {
    const content = inputText.value.trim();

    if (!content || isSending.value) {
      return;
    }

    if (!context.tabId) {
      error.value = "请先打开一个终端标签页，再使用服务器上下文 AI。";
      return;
    }

    error.value = "";
    inputText.value = "";
    isSending.value = true;

    const userMessage = createMessage("user", content);
    const conversation = getActiveConversation(context.tabId);
    // 发送给主进程的历史只包含既有对话，避免把当前空占位回复传给模型。
    const requestHistory = toPlainAiHistory(
      conversation.messages.slice(-HISTORY_LIMIT),
    );
    appendMessages(context.tabId, [userMessage]);

    const activeStreamIds = new Set<string>();
    const removeListeners = attachAiStreamListeners(
      context.tabId,
      activeStreamIds,
    );

    try {
      const plainContext = toPlainAiContext(context);

      const result = await core.orbitSSHApi.ai.chat({
        tabId: plainContext.tabId,
        mode: mode.value,
        message: content,
        context: plainContext,
        history: requestHistory,
      });

      reconcileStreamMessages(context.tabId, activeStreamIds, result.messages);
      mergeCommandCards(context.tabId, result.commandCards);
    } catch (sendError) {
      reconcileStreamMessages(context.tabId, activeStreamIds, []);
      error.value =
        sendError instanceof Error ? sendError.message : String(sendError);
    } finally {
      removeListeners();
      isSending.value = false;
    }
  }

  async function runApprovedCommand(card: AiCommandCard): Promise<void> {
    const approvalId = card.approvalId;

    if (!approvalId) {
      return;
    }

    isSending.value = true;

    const activeStreamIds = new Set<string>();
    const removeListeners = attachAiStreamListeners(card.tabId, activeStreamIds);

    try {
      const result = await core.orbitSSHApi.ai.runApprovedCommand({
        tabId: card.tabId,
        command: card.command,
        approvalId,
      });

      reconcileStreamMessages(card.tabId, activeStreamIds, result.messages);
      mergeCommandCards(card.tabId, result.commandCards);
    } catch (runError) {
      reconcileStreamMessages(card.tabId, activeStreamIds, []);
      updateCommandCard({
        ...card,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
    } finally {
      removeListeners();
      isSending.value = false;
    }
  }

  async function rejectApproval(card: AiCommandCard): Promise<void> {
    if (!card.approvalId) {
      updateCommandCard({ ...card, status: "rejected" });
      return;
    }

    try {
      await core.orbitSSHApi.ai.rejectCommandApproval({
        approvalId: card.approvalId,
      });
    } finally {
      updateCommandCard({ ...card, status: "rejected" });
    }
  }

  async function cancelMessage(context: AiContextInput): Promise<void> {
    if (!context.tabId || !isSending.value) return;

    try {
      await core.orbitSSHApi.ai.cancel({ tabId: context.tabId });
    } catch (cancelError) {
      core.writeRendererLog(
        "终止 AI 请求失败",
        {
          tabId: context.tabId,
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        },
        "warn",
      );
    } finally {
      isSending.value = false;
    }
  }

  return {
    isPanelOpen,
    mode,
    inputText,
    isSending,
    error,
    messages,
    commandCards,
    shouldSuggestNewConversation,
    canUseAi,
    togglePanel,
    setMode,
    setActiveTabId,
    startNewConversation,
    removeTabSession,
    sendMessage,
    runApprovedCommand,
    rejectApproval,
    cancelMessage,
  };
});
