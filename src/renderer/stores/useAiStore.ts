import { defineStore } from "pinia";
import { computed, onScopeDispose, ref } from "vue";

import type {
  AiCommandCard,
  AiContextInput,
  AiContextUsage,
  AiConversationRecord,
  AiConversationSummary,
  AiMessage,
  AiMode,
} from "../../shared/ai";
import { useCoreStore } from "./useCoreStore";
import { useSettingsStore } from "./useSettingsStore";

interface AiConversationState {
  id: string;
  /** 对话归属的服务器，持久化与历史列表都按此关联，与临时 tabId 解耦。 */
  serverId: string;
  title: string;
  /** 对话创建时锁定，设置变更只会影响之后新建的对话。 */
  presetPrompt: string;
  messages: AiMessage[];
  commandCards: AiCommandCard[];
  contextUsage?: AiContextUsage;
  createdAt: number;
  updatedAt: number;
  /** 仅摘要态记录携带：历史列表拉取时尚未加载正文，切换时再按 id 取完整记录。 */
  messageCount?: number;
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

// 主进程会在模型上下文达到 80% 时压缩；这里只保留较高的 IPC 安全上限。
const HISTORY_LIMIT = 500;
const LONG_CONVERSATION_USER_MESSAGE_LIMIT = 12;
const LONG_CONVERSATION_COMMAND_CARD_LIMIT = 20;
// 自动生成对话标题的最大长度（首条用户消息截断）。
const CONVERSATION_TITLE_LIMIT = 30;

function createMessage(role: AiMessage["role"], content: string): AiMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}

function createConversation(
  presetPrompt: string,
  serverId: string,
  title = "新对话",
): AiConversationState {
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    serverId,
    title,
    presetPrompt,
    messages: [],
    commandCards: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createTitleFromMessage(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, CONVERSATION_TITLE_LIMIT);
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
  // 终端标签页 → 服务器 ID 的映射，AI 对话历史按 serverId 持久化。
  const serverIdByTabId = ref<Record<string, string>>({});
  // 记录每个标签页已加载过哪个服务器的历史，避免来回切换标签页时重复拉取。
  const loadedServerIdByTabId = new Map<string, string>();

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
  const contextUsage = computed(() => activeConversation.value?.contextUsage);
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
  const activeConversationId = computed(
    () => activeConversation.value?.id ?? "",
  );
  // 当前标签页可见的历史对话摘要：只列出有实际内容的对话，按更新时间倒序。
  const conversations = computed<AiConversationSummary[]>(() => {
    const session = activeTabId.value
      ? sessionsByTabId.value[activeTabId.value]
      : undefined;

    if (!session) {
      return [];
    }

    return session.conversations
      .filter(
        conversation =>
          conversation.messages.length > 0 ||
          (conversation.messageCount ?? 0) > 0,
      )
      .map(conversation => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount:
          conversation.messages.length > 0
            ? conversation.messages.length
            : (conversation.messageCount ?? 0),
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
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

  function setActiveTabId(tabId: string, serverId = ""): void {
    activeTabId.value = tabId;

    if (!tabId) {
      return;
    }

    if (serverId) {
      serverIdByTabId.value = {
        ...serverIdByTabId.value,
        [tabId]: serverId,
      };
    }

    getActiveConversation(tabId);

    if (serverId && loadedServerIdByTabId.get(tabId) !== serverId) {
      loadedServerIdByTabId.set(tabId, serverId);
      void loadPersistedConversations(tabId, serverId);
    }
  }

  // 拉取该服务器的持久化对话摘要，合并进当前标签页会话。
  // 加载失败不打断聊天，仅记录日志，历史列表显示为空。
  async function loadPersistedConversations(
    tabId: string,
    serverId: string,
  ): Promise<void> {
    try {
      const summaries = await core.orbitSSHApi.ai.conversations.list(serverId);

      // 标签页可能已在请求期间关闭，确认会话仍在再合并。
      const session = sessionsByTabId.value[tabId];
      if (!session) {
        return;
      }

      const existingIds = new Set(
        session.conversations.map(conversation => conversation.id),
      );
      const stubs = summaries
        .filter(summary => !existingIds.has(summary.id))
        .map(summary => createStubConversation(summary, serverId));

      if (stubs.length === 0) {
        return;
      }

      sessionsByTabId.value = {
        ...sessionsByTabId.value,
        [tabId]: {
          ...session,
          conversations: [...session.conversations, ...stubs],
        },
      };
    } catch (error) {
      core.writeRendererLog(
        "AI 历史对话加载失败",
        {
          tabId,
          serverId,
          error: error instanceof Error ? error.message : String(error),
        },
        "warn",
      );
    }
  }

  // 摘要态对话：正文未加载，切换查看时再按 id 拉取完整记录。
  function createStubConversation(
    summary: AiConversationSummary,
    serverId: string,
  ): AiConversationState {
    return {
      id: summary.id,
      serverId,
      title: summary.title,
      presetPrompt: "",
      messages: [],
      commandCards: [],
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      messageCount: summary.messageCount,
    };
  }

  // 每个终端标签页维护独立 AI 会话，避免不同服务器的历史互相污染。
  function getTabSession(tabId: string): AiTabSessionState {
    const existing = sessionsByTabId.value[tabId];

    if (existing) {
      return existing;
    }

    const conversation = createConversation(
      settingsStore.appSettings.ai.presetPrompt,
      serverIdByTabId.value[tabId] ?? "",
    );
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

    const conversation = createConversation(
      settingsStore.appSettings.ai.presetPrompt,
      serverIdByTabId.value[tabId] ?? "",
    );
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

  function updateContextUsage(
    tabId: string,
    conversationId: string,
    usage: AiContextUsage | undefined,
  ): void {
    if (!usage) return;
    updateConversation(tabId, conversation => ({
      ...conversation,
      contextUsage: usage,
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
    const conversation = createConversation(
      settingsStore.appSettings.ai.presetPrompt,
      serverIdByTabId.value[tabId] ?? "",
    );

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        activeConversationId: conversation.id,
        conversations: [...session.conversations, conversation],
      },
    };
    setTabError(tabId, "");
  }

  // 把持久化的完整记录替换进会话（摘要态 → 正文态），保留当前激活 ID。
  function replaceConversationInSession(
    tabId: string,
    record: AiConversationRecord,
  ): void {
    const session = sessionsByTabId.value[tabId];
    if (!session) return;

    const conversation: AiConversationState = {
      id: record.id,
      serverId: serverIdByTabId.value[tabId] ?? "",
      title: record.title,
      presetPrompt: record.presetPrompt,
      messages: record.messages,
      commandCards: record.commandCards,
      contextUsage: record.contextUsage,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        ...session,
        conversations: session.conversations.map(item =>
          item.id === record.id ? conversation : item,
        ),
      },
    };
  }

  // 切换查看/续聊历史对话：与“新对话”一致，有活跃请求或待处理命令时拒绝切换。
  async function switchConversation(
    conversationId: string,
    tabId = activeTabId.value,
  ): Promise<void> {
    if (!tabId || getActiveRequest(tabId) || hasBlockingCommandProcess(tabId)) {
      return;
    }

    const session = getTabSession(tabId);
    const target = session.conversations.find(
      conversation => conversation.id === conversationId,
    );

    if (!target || session.activeConversationId === conversationId) {
      return;
    }

    // 摘要态记录先拉取完整正文，拉取失败保持原状并提示。
    if (target.messages.length === 0) {
      const serverId = serverIdByTabId.value[tabId] ?? "";
      if (!serverId) {
        return;
      }

      try {
        const record = await core.orbitSSHApi.ai.conversations.get(
          serverId,
          conversationId,
        );

        if (!record) {
          setTabError(tabId, "历史对话不存在或已被删除");
          return;
        }

        replaceConversationInSession(tabId, record);
      } catch (error) {
        setTabError(
          tabId,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }

    // 重新读取会话：拉取期间状态可能已被其他操作修改。
    const currentSession = sessionsByTabId.value[tabId];
    if (
      !currentSession ||
      !currentSession.conversations.some(
        conversation => conversation.id === conversationId,
      )
    ) {
      return;
    }

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        ...currentSession,
        activeConversationId: conversationId,
      },
    };
    setTabError(tabId, "");
  }

  // 删除历史对话：当前对话有活跃请求或待处理命令时不允许删除。
  async function deleteConversation(
    conversationId: string,
    tabId = activeTabId.value,
  ): Promise<void> {
    if (!tabId) {
      return;
    }

    const session = sessionsByTabId.value[tabId];
    if (!session) {
      return;
    }

    const target = session.conversations.find(
      conversation => conversation.id === conversationId,
    );
    if (!target) {
      return;
    }

    const isActive = session.activeConversationId === conversationId;
    if (isActive && (getActiveRequest(tabId) || hasBlockingCommandProcess(tabId))) {
      return;
    }

    const nextConversations = session.conversations.filter(
      conversation => conversation.id !== conversationId,
    );

    if (isActive) {
      const fallback = nextConversations[0];
      if (fallback) {
        session.activeConversationId = fallback.id;
      } else {
        const fresh = createConversation(
          settingsStore.appSettings.ai.presetPrompt,
          serverIdByTabId.value[tabId] ?? "",
        );
        nextConversations.push(fresh);
        session.activeConversationId = fresh.id;
      }
    }

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        ...session,
        conversations: nextConversations,
      },
    };

    const serverId = serverIdByTabId.value[tabId];
    if (serverId) {
      try {
        await core.orbitSSHApi.ai.conversations.delete(
          serverId,
          conversationId,
        );
      } catch (error) {
        core.writeRendererLog(
          "AI 历史对话删除失败",
          {
            tabId,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "warn",
        );
      }
    }
  }

  // IPC 只能传递可结构化克隆的数据，持久化前把响应式对象转为普通对象。
  function toPlainConversationRecord(
    conversation: AiConversationState,
  ): AiConversationRecord {
    return {
      id: conversation.id,
      title: conversation.title,
      presetPrompt: conversation.presetPrompt,
      messages: toPlainAiHistory(conversation.messages),
      commandCards: conversation.commandCards.map(card => ({
        ...card,
        result: card.result
          ? {
              stdout: card.result.stdout,
              stderr: card.result.stderr,
              exitCode: card.result.exitCode,
              timedOut: card.result.timedOut,
              durationMs: card.result.durationMs,
            }
          : undefined,
      })),
      contextUsage: conversation.contextUsage
        ? { ...conversation.contextUsage }
        : undefined,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  // 请求结束或卡片终态时写盘；空对话不落盘。写盘失败不影响聊天。
  function persistConversation(tabId: string, conversationId: string): void {
    const session = sessionsByTabId.value[tabId];
    const conversation = session?.conversations.find(
      item => item.id === conversationId,
    );
    const serverId = serverIdByTabId.value[tabId];

    if (!conversation || !serverId || conversation.messages.length === 0) {
      return;
    }

    core.orbitSSHApi.ai.conversations
      .save({
        serverId,
        conversation: toPlainConversationRecord(conversation),
      })
      .catch(error => {
        core.writeRendererLog(
          "AI 对话持久化失败",
          {
            tabId,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "warn",
        );
      });
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
    const nextServerIds = { ...serverIdByTabId.value };
    delete nextDrafts[tabId];
    delete nextErrors[tabId];
    delete nextRequests[tabId];
    delete nextServerIds[tabId];
    draftsByTabId.value = nextDrafts;
    errorsByTabId.value = nextErrors;
    activeRequestsByTabId.value = nextRequests;
    serverIdByTabId.value = nextServerIds;
    loadedServerIdByTabId.delete(tabId);
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

    // 首条用户消息自动生成对话标题，供历史列表展示。
    if (conversation.title === "新对话") {
      updateConversation(
        context.tabId,
        item => ({ ...item, title: createTitleFromMessage(content) }),
        conversationId,
      );
    }

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
        presetPrompt: conversation.presetPrompt,
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
      updateContextUsage(context.tabId, conversationId, result.contextUsage);
    } catch (sendError) {
      reconcileStreamMessages(context.tabId, requestId, conversationId, []);
      setTabError(
        context.tabId,
        sendError instanceof Error ? sendError.message : String(sendError),
      );
    } finally {
      // 无论成败都落盘：失败时也保留已发出的用户消息，便于下次续聊。
      persistConversation(context.tabId, conversationId);
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
      updateContextUsage(card.tabId, conversationId, result.contextUsage);
    } catch (runError) {
      reconcileStreamMessages(card.tabId, requestId, conversationId, []);
      updateCommandCard({
        ...card,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
    } finally {
      persistConversation(card.tabId, conversationId);
      clearActiveRequest(card.tabId, requestId);
    }
  }

  async function rejectApproval(card: AiCommandCard): Promise<void> {
    if (!card.approvalId) {
      updateCommandCard({ ...card, status: "rejected" });
      persistConversation(card.tabId, card.conversationId);
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
      persistConversation(card.tabId, card.conversationId);
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
    contextUsage,
    shouldSuggestNewConversation,
    canUseAi,
    conversations,
    activeConversationId,
    togglePanel,
    setMode,
    setActiveTabId,
    startNewConversation,
    switchConversation,
    deleteConversation,
    removeTabSession,
    sendMessage,
    runApprovedCommand,
    rejectApproval,
    cancelMessage,
  };
});
