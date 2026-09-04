import { defineStore } from "pinia";
import { computed, onScopeDispose, ref } from "vue";

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

interface AiActiveRequestState {
  requestId: string;
  conversationId: string;
}

interface AiStreamState extends AiActiveRequestState {
  tabId: string;
  messageIds: Set<string>;
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
  const activeTabId = ref("");
  const sessionsByTabId = ref<Record<string, AiTabSessionState>>({});
  const draftsByTabId = ref<Record<string, string>>({});
  const errorsByTabId = ref<Record<string, string>>({});
  const activeRequestsByTabId = ref<Record<string, AiActiveRequestState>>({});
  const streamStatesByRequestId = new Map<string, AiStreamState>();

  const inputText = computed({
    get: () => draftsByTabId.value[activeTabId.value] ?? "",
    set: (value: string) => {
      if (!activeTabId.value) return;
      draftsByTabId.value = {
        ...draftsByTabId.value,
        [activeTabId.value]: value,
      };
    },
  });
  const isSending = computed(() =>
    Boolean(activeRequestsByTabId.value[activeTabId.value]),
  );
  const error = computed(() => errorsByTabId.value[activeTabId.value] ?? "");

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

  function getActiveRequest(tabId: string): AiActiveRequestState | undefined {
    return activeRequestsByTabId.value[tabId];
  }

  function setActiveRequest(tabId: string, request: AiActiveRequestState): void {
    activeRequestsByTabId.value = {
      ...activeRequestsByTabId.value,
      [tabId]: request,
    };
  }

  function clearActiveRequest(tabId: string, requestId: string): void {
    if (activeRequestsByTabId.value[tabId]?.requestId !== requestId) return;
    const nextRequests = { ...activeRequestsByTabId.value };
    delete nextRequests[tabId];
    activeRequestsByTabId.value = nextRequests;
    for (const [requestId, streamState] of streamStatesByRequestId) {
      if (streamState.tabId === tabId) streamStatesByRequestId.delete(requestId);
    }
  }

  function setTabError(tabId: string, message: string): void {
    errorsByTabId.value = { ...errorsByTabId.value, [tabId]: message };
  }

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
    conversationId?: string,
  ): void {
    const session = sessionsByTabId.value[tabId];
    if (!session) return;
    const targetConversationId = conversationId ?? session.activeConversationId;

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        ...session,
        conversations: session.conversations.map(conversation =>
          conversation.id === targetConversationId
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
    }), card.conversationId);
  }

  function mergeCommandCards(
    tabId: string,
    cards: AiCommandCard[],
    conversationId: string,
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
    }, conversationId);
  }

  function appendMessages(
    tabId: string,
    conversationId: string,
    nextMessages: AiMessage[],
  ): void {
    updateConversation(tabId, conversation => ({
      ...conversation,
      messages: [...conversation.messages, ...nextMessages],
      updatedAt: Date.now(),
    }), conversationId);
  }

  function removeMessage(
    tabId: string,
    conversationId: string,
    messageId: string,
  ): void {
    updateConversation(tabId, conversation => ({
      ...conversation,
      messages: conversation.messages.filter(message => message.id !== messageId),
      updatedAt: Date.now(),
    }), conversationId);
  }

  function appendStreamChunk(
    tabId: string,
    conversationId: string,
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
    }), conversationId);
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
    if (!tabId || getActiveRequest(tabId) || hasBlockingCommandProcess(tabId)) {
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
    setTabError(tabId, "");
  }

  function removeTabSession(tabId: string): void {
    if (!tabId) {
      return;
    }

    const nextSessions = { ...sessionsByTabId.value };
    delete nextSessions[tabId];
    sessionsByTabId.value = nextSessions;
    const nextDrafts = { ...draftsByTabId.value };
    const nextErrors = { ...errorsByTabId.value };
    const nextRequests = { ...activeRequestsByTabId.value };
    delete nextDrafts[tabId];
    delete nextErrors[tabId];
    delete nextRequests[tabId];
    draftsByTabId.value = nextDrafts;
    errorsByTabId.value = nextErrors;
    activeRequestsByTabId.value = nextRequests;
    for (const [requestId, streamState] of streamStatesByRequestId) {
      if (streamState.tabId === tabId) streamStatesByRequestId.delete(requestId);
    }

    if (activeTabId.value === tabId) {
      activeTabId.value = "";
    }
  }

  // Store 生命周期内只注册一次监听器，审批过期等异步事件也能更新原对话。
  // 所有事件按 requestId + conversationId + tabId 路由，避免切换标签页后串流。
  const ai = core.orbitSSHApi?.ai;
  const removeStreamMessageStartListener = ai?.onStreamMessageStart(event => {
    const streamState: AiStreamState = streamStatesByRequestId.get(event.requestId) ?? {
      tabId: event.tabId,
      requestId: event.requestId,
      conversationId: event.conversationId,
      messageIds: new Set<string>(),
    };
    if (
      streamState.tabId !== event.tabId ||
      streamState.conversationId !== event.conversationId
    ) return;
    streamState.messageIds.add(event.messageId);
    streamStatesByRequestId.set(event.requestId, streamState);
    appendMessages(event.tabId, event.conversationId, [
      {
        id: event.messageId,
        role: "assistant",
        content: "",
        createdAt: event.createdAt,
      },
    ]);
  });
  const removeStreamChunkListener = ai?.onStreamChunk(event => {
    const streamState = streamStatesByRequestId.get(event.requestId);
    if (
      !streamState ||
      streamState.tabId !== event.tabId ||
      streamState.conversationId !== event.conversationId ||
      !streamState.messageIds.has(event.messageId)
    ) return;
    appendStreamChunk(
      event.tabId,
      event.conversationId,
      event.messageId,
      event.chunk,
    );
  });
  const removeCommandCardListener = ai?.onCommandCard(event => {
    if (event.card.conversationId !== event.conversationId) return;
    mergeCommandCards(event.tabId, [event.card], event.conversationId);
  });
  onScopeDispose(() => {
    removeStreamMessageStartListener?.();
    removeStreamChunkListener?.();
    removeCommandCardListener?.();
  });

  // 对账：移除本轮所有流式占位消息，再用主进程返回的最终消息整体替换，
  // 避免流式累积与最终结果重复或残留空占位。
  function reconcileStreamMessages(
    tabId: string,
    requestId: string,
    conversationId: string,
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

    const streamState = streamStatesByRequestId.get(requestId);
    for (const id of streamState?.messageIds ?? []) {
      removeMessage(tabId, conversationId, id);
    }
    streamStatesByRequestId.delete(requestId);
    if (settledMessages.length > 0) {
      appendMessages(tabId, conversationId, settledMessages);
    }
  }

  async function sendMessage(context: AiContextInput): Promise<void> {
    const content = inputText.value.trim();

    if (!content || (context.tabId && getActiveRequest(context.tabId))) {
      return;
    }

    if (!context.tabId) {
      setTabError("", "请先打开一个终端标签页，再使用服务器上下文 AI。");
      return;
    }

    const conversation = getActiveConversation(context.tabId);
    const requestId = crypto.randomUUID();
    const conversationId = conversation.id;
    setTabError(context.tabId, "");
    draftsByTabId.value = { ...draftsByTabId.value, [context.tabId]: "" };
    setActiveRequest(context.tabId, { requestId, conversationId });

    const userMessage = createMessage("user", content);
    // 发送给主进程的历史只包含既有对话，避免把当前空占位回复传给模型。
    const requestHistory = toPlainAiHistory(
      conversation.messages.slice(-HISTORY_LIMIT),
    );
    appendMessages(context.tabId, conversationId, [userMessage]);

    try {
      const plainContext = toPlainAiContext(context);

      const result = await core.orbitSSHApi.ai.chat({
        tabId: plainContext.tabId,
        requestId,
        conversationId,
        mode: mode.value,
        message: content,
        context: plainContext,
        history: requestHistory,
      });

      reconcileStreamMessages(
        context.tabId,
        requestId,
        conversationId,
        result.messages,
      );
      mergeCommandCards(context.tabId, result.commandCards, conversationId);
    } catch (sendError) {
      reconcileStreamMessages(context.tabId, requestId, conversationId, []);
      setTabError(
        context.tabId,
        sendError instanceof Error ? sendError.message : String(sendError),
      );
    } finally {
      clearActiveRequest(context.tabId, requestId);
    }
  }

  async function runApprovedCommand(card: AiCommandCard): Promise<void> {
    const approvalId = card.approvalId;

    if (!approvalId) {
      return;
    }
    if (getActiveRequest(card.tabId)) return;

    const requestId = crypto.randomUUID();
    const conversationId = card.conversationId;
    setTabError(card.tabId, "");
    setActiveRequest(card.tabId, { requestId, conversationId });

    try {
      const result = await core.orbitSSHApi.ai.runApprovedCommand({
        tabId: card.tabId,
        requestId,
        conversationId,
        command: card.command,
        approvalId,
      });

      reconcileStreamMessages(
        card.tabId,
        requestId,
        conversationId,
        result.messages,
      );
      mergeCommandCards(card.tabId, result.commandCards, conversationId);
    } catch (runError) {
      reconcileStreamMessages(card.tabId, requestId, conversationId, []);
      updateCommandCard({
        ...card,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
    } finally {
      clearActiveRequest(card.tabId, requestId);
    }
  }

  async function rejectApproval(card: AiCommandCard): Promise<void> {
    if (!card.approvalId) {
      updateCommandCard({ ...card, status: "rejected" });
      return;
    }

    try {
      await core.orbitSSHApi.ai.rejectCommandApproval({
        tabId: card.tabId,
        conversationId: card.conversationId,
        approvalId: card.approvalId,
      });
    } finally {
      updateCommandCard({ ...card, status: "rejected" });
    }
  }

  async function cancelMessage(context: AiContextInput): Promise<void> {
    if (!context.tabId) return;
    const activeRequest = getActiveRequest(context.tabId);
    if (!activeRequest) return;

    try {
      await core.orbitSSHApi.ai.cancel({
        tabId: context.tabId,
        requestId: activeRequest.requestId,
      });
    } catch (cancelError) {
      core.writeRendererLog(
        "终止 AI 请求失败",
        {
          tabId: context.tabId,
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        },
        "warn",
      );
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
