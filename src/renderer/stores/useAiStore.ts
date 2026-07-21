import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

import {
  DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB,
  MAX_AI_ATTACHMENT_COUNT,
  MAX_AI_ATTACHMENT_SIZE_MB,
  AI_TEXT_ATTACHMENT_CHUNK_THRESHOLD_BYTES,
  isAiTextAttachment,
  type AiAttachment,
  type AiCommandCard,
  type AiCommandStatus,
  type AiContextInput,
  type AiConversationCompaction,
  type AiConversationSummary,
  type AiMessage,
  type AiMessageAttachment,
  type AiMode,
} from "../../shared/ai";
import {
  getAttachmentInputModality,
  resolveAiConfigForAttachments,
} from "../../shared/ai-model-capabilities";
import { useCoreStore } from "./useCoreStore";
import { useSettingsStore } from "./useSettingsStore";
import {
  deleteAiAttachments,
  loadAiAttachments,
  saveAiAttachments,
} from "../utils/ai-attachment-storage";

interface AiConversationState {
  id: string;
  title: string;
  serverId: string;
  serverName: string;
  tabId: string;
  messages: AiMessage[];
  commandCards: AiCommandCard[];
  compaction?: AiConversationCompaction;
  createdAt: number;
  updatedAt: number;
}

interface AiTabSessionState {
  activeConversationId: string;
}

const HISTORY_LIMIT = 200;
const LONG_CONVERSATION_USER_MESSAGE_LIMIT = 12;
const LONG_CONVERSATION_COMMAND_CARD_LIMIT = 20;
const AI_CONVERSATION_STORAGE_KEY = "orbitssh.ai-conversations.v1";
const MAX_PERSISTED_CONVERSATIONS = 50;
const MAX_PERSISTED_MESSAGES = 200;
const MAX_CONVERSATION_TITLE_LENGTH = 80;
const TRANSIENT_COMMAND_STATUSES = new Set<AiCommandStatus>([
  "pending",
  "running",
  "requires_approval",
]);

function createMessage(
  role: AiMessage["role"],
  content: string,
  attachments: AiMessageAttachment[] = [],
): AiMessage {
  const message: AiMessage = {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
  if (attachments.length > 0) message.attachments = attachments;
  return message;
}

function createMessageAttachments(
  attachments: AiAttachment[],
): AiMessageAttachment[] {
  return attachments.map(attachment => ({
    id: attachment.id || crypto.randomUUID(),
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    delivery: attachment.delivery,
    dataUrl: attachment.dataUrl,
  }));
}

function normalizeStoredMessageAttachments(
  value: unknown,
): AiMessageAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const attachment = item as Partial<AiMessageAttachment>;
    if (
      typeof attachment.id !== "string" ||
      typeof attachment.name !== "string" ||
      typeof attachment.mimeType !== "string" ||
      !Number.isFinite(attachment.size)
    ) {
      return [];
    }
    return [{
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: Number(attachment.size),
      delivery: attachment.delivery === "chunked" ? "chunked" : "inline",
    } satisfies AiMessageAttachment];
  });
  return attachments.length > 0 ? attachments : undefined;
}

function createConversation(
  title = "新对话",
  serverId = "",
  serverName = "",
  tabId = "",
): AiConversationState {
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    title,
    serverId,
    serverName,
    tabId,
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
    serverId: context.serverId,
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

function toPlainAiCompaction(
  compaction?: AiConversationCompaction,
): AiConversationCompaction | undefined {
  if (!compaction) return undefined;
  return {
    content: compaction.content,
    coveredThroughMessageId: compaction.coveredThroughMessageId,
    coveredThroughCreatedAt: compaction.coveredThroughCreatedAt,
    updatedAt: compaction.updatedAt,
  };
}

function isConversationMeaningful(
  conversation: AiConversationState,
): boolean {
  return (
    conversation.messages.length > 0 ||
    conversation.commandCards.length > 0 ||
    Boolean(conversation.compaction)
  );
}

function getUncompactedHistory(
  conversation: AiConversationState,
): AiMessage[] {
  const compaction = conversation.compaction;
  if (!compaction) return conversation.messages;
  const coveredIndex = conversation.messages.findIndex(
    message => message.id === compaction.coveredThroughMessageId,
  );
  if (coveredIndex >= 0) return conversation.messages.slice(coveredIndex + 1);
  return conversation.messages.filter(
    message => message.createdAt > compaction.coveredThroughCreatedAt,
  );
}

function normalizeStoredCompaction(
  value: unknown,
): AiConversationCompaction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<AiConversationCompaction>;
  if (
    typeof record.content !== "string" ||
    !record.content ||
    typeof record.coveredThroughMessageId !== "string" ||
    !record.coveredThroughMessageId ||
    !Number.isFinite(record.coveredThroughCreatedAt) ||
    !Number.isFinite(record.updatedAt)
  ) {
    return undefined;
  }
  return {
    content: record.content,
    coveredThroughMessageId: record.coveredThroughMessageId,
    coveredThroughCreatedAt: Number(record.coveredThroughCreatedAt),
    updatedAt: Number(record.updatedAt),
  };
}

function bindConversationToTab(
  conversation: AiConversationState,
  tabId: string,
): AiConversationState {
  const tabChanged = Boolean(conversation.tabId && conversation.tabId !== tabId);

  return {
    ...conversation,
    tabId,
    commandCards: conversation.commandCards.map(card => {
      if (tabChanged && TRANSIENT_COMMAND_STATUSES.has(card.status)) {
        return {
          ...card,
          tabId,
          status: "cancelled",
          approvalId: undefined,
          error: card.error ?? "原终端会话已关闭，命令未执行",
        };
      }

      return { ...card, tabId };
    }),
  };
}

export const useAiStore = defineStore("ai", () => {
  const core = useCoreStore();
  const settingsStore = useSettingsStore();

  const isPanelOpen = ref(true);
  const mode = ref<AiMode>(settingsStore.appSettings.ai.defaultMode);
  const inputText = ref("");
  const sendingTabIds = ref<Set<string>>(new Set());
  const requestTokensByTabId = new Map<string, string>();
  const error = ref("");
  const pendingAttachments = ref<AiAttachment[]>([]);
  const activeTabId = ref("");
  const activeTabServerId = ref("");
  const activeTabServerName = ref("");
  const activeTabStatus = ref<AiContextInput["status"]>("disconnected");
  const activeConversationId = ref("");
  const conversations = ref<AiConversationState[]>([]);
  const sessionsByTabId = ref<Record<string, AiTabSessionState>>({});
  let conversationHydrated = false;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  const canUseAi = computed(() => settingsStore.appSettings.ai.enabled);
  const isSending = computed(() => isTabSending(activeTabId.value));
  const activeConversation = computed(
    () =>
      conversations.value.find(
        conversation => conversation.id === activeConversationId.value,
      ) ?? null,
  );
  const conversationHistory = computed<AiConversationSummary[]>(() =>
    conversations.value
      .filter(isConversationMeaningful)
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(conversation => ({
        id: conversation.id,
        title: conversation.title,
        serverId: conversation.serverId,
        serverName: conversation.serverName,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
      })),
  );
  const conversationContextReady = computed(() => {
    const conversation = activeConversation.value;
    if (
      !activeTabId.value ||
      !activeTabServerId.value ||
      activeTabStatus.value !== "connected"
    ) {
      return false;
    }
    if (!conversation) return true;
    return (
      conversation.tabId === activeTabId.value &&
      conversation.serverId === activeTabServerId.value
    );
  });
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

  function isTabSending(tabId: string): boolean {
    return Boolean(tabId && sendingTabIds.value.has(tabId));
  }

  function beginTabRequest(tabId: string): string {
    const requestToken = crypto.randomUUID();
    requestTokensByTabId.set(tabId, requestToken);
    sendingTabIds.value.add(tabId);
    return requestToken;
  }

  function finishTabRequest(tabId: string, requestToken: string): void {
    if (requestTokensByTabId.get(tabId) !== requestToken) return;
    requestTokensByTabId.delete(tabId);
    sendingTabIds.value.delete(tabId);
  }

  function cancelTabRequest(tabId: string): void {
    requestTokensByTabId.delete(tabId);
    sendingTabIds.value.delete(tabId);
  }

  function setActiveTabId(
    tabId: string,
    serverId = "",
    serverName = "",
    status: AiContextInput["status"] = "disconnected",
  ): void {
    activeTabId.value = tabId;
    activeTabServerId.value = serverId;
    activeTabServerName.value = serverName;
    activeTabStatus.value = status;

    if (!tabId) {
      activeConversationId.value = "";
      return;
    }

    const session = getTabSession(tabId);
    const nextConversation = conversations.value.find(conversation =>
      conversation.id === session.activeConversationId,
    );
    if (nextConversation) {
      const boundConversation = bindConversationToTab(nextConversation, tabId);
      boundConversation.serverId ||= serverId;
      boundConversation.serverName ||= serverName;
      conversations.value = conversations.value.map(conversation =>
        conversation.id === boundConversation.id ? boundConversation : conversation,
      );
      activeConversationId.value = nextConversation.id;
      session.activeConversationId = nextConversation.id;
    } else {
      activeConversationId.value = "";
      session.activeConversationId = "";
    }
  }

  // Tab 只记录当前选中的会话；会话本身独立存在，关闭 Tab 后仍保留历史。
  function getTabSession(tabId: string): AiTabSessionState {
    const existing = sessionsByTabId.value[tabId];

    if (existing) {
      return existing;
    }

    const session = {
      activeConversationId: "",
    };

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: session,
    };

    return session;
  }

  function getActiveConversation(tabId: string): AiConversationState {
    const session = getTabSession(tabId);
    const active = conversations.value.find(
      conversation => conversation.id === session.activeConversationId,
    );

    if (active) {
      if (tabId === activeTabId.value) {
        activeConversationId.value = active.id;
      }
      return active;
    }

    const conversation = createConversation(
      "新对话",
      activeTabServerId.value,
      activeTabServerName.value,
      tabId,
    );
    conversations.value = [...conversations.value, conversation];
    session.activeConversationId = conversation.id;
    if (tabId === activeTabId.value) {
      activeConversationId.value = conversation.id;
    }

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
      conversations.value.find(
        conversation => conversation.id === session.activeConversationId,
      ) ?? null
    );
  }

  function updateConversation(
    tabId: string,
    updater: (conversation: AiConversationState) => AiConversationState,
  ): void {
    const session = getTabSession(tabId);
    const conversationIndex = conversations.value.findIndex(
      item => item.id === session.activeConversationId,
    );
    const conversation =
      conversationIndex >= 0 ? conversations.value[conversationIndex] : undefined;
    if (!conversation) return;

    const updatedConversation = updater(conversation);
    if (updatedConversation !== conversation) {
      conversations.value[conversationIndex] = updatedConversation;
    }
    schedulePersistConversations();
  }

  function getConversation(conversationId: string): AiConversationState | null {
    return (
      conversations.value.find(
        conversation => conversation.id === conversationId,
      ) ?? null
    );
  }

  function activateConversation(conversationId: string): boolean {
    let conversation = getConversation(conversationId);
    if (!conversation) return false;

    activeConversationId.value = conversation.id;
    if (
      activeTabId.value &&
      (!conversation.tabId || conversation.tabId === activeTabId.value) &&
      conversation.serverId === activeTabServerId.value
    ) {
      const boundConversation = bindConversationToTab(conversation, activeTabId.value);
      conversations.value = conversations.value.map(item =>
        item.id === boundConversation.id ? boundConversation : item,
      );
      conversation = boundConversation;
      const session = getTabSession(activeTabId.value);
      session.activeConversationId = conversation.id;
    }
    error.value = "";
    return true;
  }

  function renameConversation(conversationId: string, title: string): boolean {
    const normalizedTitle = title.trim();
    if (
      !normalizedTitle ||
      normalizedTitle.length > MAX_CONVERSATION_TITLE_LENGTH
    ) {
      error.value = `会话名称须为 1-${MAX_CONVERSATION_TITLE_LENGTH} 个字符。`;
      return false;
    }

    const conversationIndex = conversations.value.findIndex(
      conversation => conversation.id === conversationId,
    );
    if (conversationIndex < 0) return false;

    const conversation = conversations.value[conversationIndex];
    if (!conversation || conversation.title === normalizedTitle) {
      error.value = "";
      return true;
    }

    conversations.value = conversations.value.map(item =>
      item.id === conversationId
        ? { ...item, title: normalizedTitle }
        : item,
    );
    error.value = "";
    schedulePersistConversations();
    return true;
  }

  function deleteConversation(conversationId: string): boolean {
    const conversation = getConversation(conversationId);
    if (!conversation) return false;

    const hasTransientCommand = conversation.commandCards.some(card =>
      TRANSIENT_COMMAND_STATUSES.has(card.status),
    );
    if (
      hasTransientCommand ||
      isTabSending(conversation.tabId)
    ) {
      error.value = "该会话仍有正在执行或等待确认的任务，暂时无法删除。";
      return false;
    }

    const wasActive = activeConversationId.value === conversationId;
    const attachmentIds = conversation.messages.flatMap(message =>
      message.attachments?.map(attachment => attachment.id) ?? [],
    );
    const remainingConversations = conversations.value.filter(
      item => item.id !== conversationId,
    );
    const nextSessions: Record<string, AiTabSessionState> = {};

    for (const [tabId, session] of Object.entries(sessionsByTabId.value)) {
      if (session.activeConversationId !== conversationId) {
        nextSessions[tabId] = session;
        continue;
      }

      const replacement = remainingConversations
        .filter(item => item.tabId === tabId)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
      if (replacement) {
        nextSessions[tabId] = { activeConversationId: replacement.id };
      } else {
        nextSessions[tabId] = { activeConversationId: "" };
      }
    }

    conversations.value = remainingConversations;
    sessionsByTabId.value = nextSessions;

    if (wasActive) {
      const activeSession = activeTabId.value
        ? sessionsByTabId.value[activeTabId.value]
        : undefined;
      if (activeSession) {
        activeConversationId.value = activeSession.activeConversationId;
      } else {
        activeConversationId.value = "";
      }

      pendingAttachments.value = [];
    }

    error.value = "";
    schedulePersistConversations();
    void deleteAiAttachments(attachmentIds).catch(deleteError => {
      core.writeRendererLog(
        "AI 会话附件删除失败",
        { error: deleteError instanceof Error ? deleteError.message : String(deleteError) },
        "warn",
      );
    });
    return true;
  }

  function schedulePersistConversations(): void {
    if (!conversationHydrated || typeof localStorage === "undefined") return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      try {
        const records = conversations.value
          .filter(isConversationMeaningful)
          .slice()
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, MAX_PERSISTED_CONVERSATIONS)
          .map(conversation => ({
            ...conversation,
            messages: conversation.messages
              .slice(-MAX_PERSISTED_MESSAGES)
              .map(message => ({
                ...message,
                attachments: message.attachments?.map(
                  ({ dataUrl: _dataUrl, ...attachment }) => attachment,
                ),
              })),
            commandCards: conversation.commandCards.slice(-100),
          }));
        localStorage.setItem(AI_CONVERSATION_STORAGE_KEY, JSON.stringify(records));
      } catch (persistError) {
        core.writeRendererLog(
          "AI 会话历史保存失败",
          { error: persistError instanceof Error ? persistError.message : String(persistError) },
          "warn",
        );
      }
    }, 400);
  }

  function hydrateConversations(): void {
    if (conversationHydrated) return;
    conversationHydrated = true;
    if (typeof localStorage === "undefined") return;

    try {
      const raw = localStorage.getItem(AI_CONVERSATION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return;
      conversations.value = parsed.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const value = item as Partial<AiConversationState>;
        if (
          typeof value.id !== "string" ||
          typeof value.title !== "string" ||
          !Array.isArray(value.messages) ||
          !Array.isArray(value.commandCards)
        ) {
          return [];
        }
        const conversation: AiConversationState = {
          id: value.id,
          title: value.title || "历史会话",
          serverId: typeof value.serverId === "string" ? value.serverId : "",
          serverName: typeof value.serverName === "string" ? value.serverName : "未知服务器",
          tabId: "",
          messages: (value.messages as AiMessage[]).map(message => ({
            ...message,
            attachments: normalizeStoredMessageAttachments(message.attachments),
          })),
          compaction: normalizeStoredCompaction(value.compaction),
          commandCards: (value.commandCards as AiCommandCard[]).map(card =>
            TRANSIENT_COMMAND_STATUSES.has(card.status)
              ? {
                  ...card,
                  status: "cancelled" as const,
                  approvalId: undefined,
                  error: card.error ?? "应用重启后未执行的命令已取消",
                }
              : card,
          ),
          createdAt: Number(value.createdAt) || Date.now(),
          updatedAt: Number(value.updatedAt) || Number(value.createdAt) || Date.now(),
        };
        return isConversationMeaningful(conversation) ? [conversation] : [];
      });
      const storedAttachments = conversations.value.flatMap(conversation =>
        conversation.messages.flatMap(message => message.attachments ?? []),
      );
      void loadAiAttachments(storedAttachments)
        .then(restoredAttachments => {
          const dataUrlsById = new Map(
            restoredAttachments
              .filter(attachment => attachment.dataUrl)
              .map(attachment => [attachment.id, attachment.dataUrl] as const),
          );
          if (dataUrlsById.size === 0) return;
          conversations.value = conversations.value.map(conversation => ({
            ...conversation,
            messages: conversation.messages.map(message => ({
              ...message,
              attachments: message.attachments?.map(attachment => ({
                ...attachment,
                dataUrl: dataUrlsById.get(attachment.id),
              })),
            })),
          }));
        })
        .catch(loadError => {
          core.writeRendererLog(
            "AI 会话附件读取失败",
            { error: loadError instanceof Error ? loadError.message : String(loadError) },
            "warn",
          );
        });
    } catch (loadError) {
      core.writeRendererLog(
        "AI 会话历史读取失败",
        { error: loadError instanceof Error ? loadError.message : String(loadError) },
        "warn",
      );
    }
  }

  hydrateConversations();
  // 具体的会话更新由 updateConversation/appendStreamChunk 显式调度，
  // 避免流式输出期间每个 chunk 都深度遍历全部历史消息。
  watch(conversations, schedulePersistConversations);

  function updateCommandCard(card: AiCommandCard): void {
    updateConversation(card.tabId, conversation => {
      const cardIndex = conversation.commandCards.findIndex(
        item => item.id === card.id,
      );
      if (cardIndex >= 0) {
        conversation.commandCards[cardIndex] = card;
      }
      conversation.updatedAt = Date.now();
      return conversation;
    });
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
    updateConversation(tabId, conversation => {
      conversation.messages.push(...nextMessages);
      conversation.updatedAt = Date.now();
      return conversation;
    });
  }

  function updateCompaction(
    tabId: string,
    compaction?: AiConversationCompaction,
  ): void {
    if (!compaction) return;
    updateConversation(tabId, conversation => ({
      ...conversation,
      compaction: toPlainAiCompaction(compaction),
      updatedAt: Date.now(),
    }));
  }

  function removeMessage(tabId: string, messageId: string): void {
    updateConversation(tabId, conversation => {
      const messageIndex = conversation.messages.findIndex(
        message => message.id === messageId,
      );
      if (messageIndex >= 0) {
        conversation.messages.splice(messageIndex, 1);
      }
      conversation.updatedAt = Date.now();
      return conversation;
    });
  }

  function appendStreamChunk(
    tabId: string,
    messageId: string,
    chunk: string,
  ): void {
    const session = sessionsByTabId.value[tabId];
    const conversation = session
      ? conversations.value.find(
          item => item.id === session.activeConversationId,
        )
      : undefined;
    const message = conversation?.messages.find(item => item.id === messageId);
    if (!conversation || !message) return;

    message.content += chunk;
    conversation.updatedAt = Date.now();
    schedulePersistConversations();
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
    if (!tabId || isTabSending(tabId) || hasBlockingCommandProcess(tabId)) {
      return;
    }

    sessionsByTabId.value = {
      ...sessionsByTabId.value,
      [tabId]: {
        activeConversationId: "",
      },
    };
    if (tabId === activeTabId.value) {
      activeConversationId.value = "";
      pendingAttachments.value = [];
    }
    error.value = "";
  }

  function removeTabSession(tabId: string): void {
    if (!tabId) {
      return;
    }

    cancelTabRequest(tabId);

    const nextSessions = { ...sessionsByTabId.value };
    delete nextSessions[tabId];
    sessionsByTabId.value = nextSessions;
    conversations.value = conversations.value.map(conversation =>
      conversation.tabId === tabId
        ? {
            ...conversation,
            tabId: "",
            commandCards: conversation.commandCards.map(card =>
              TRANSIENT_COMMAND_STATUSES.has(card.status)
                ? {
                    ...card,
                    tabId: "",
                    status: "cancelled" as const,
                    approvalId: undefined,
                    error: card.error ?? "终端会话已关闭，命令未执行",
                  }
                : { ...card, tabId: "" },
            ),
          }
        : conversation,
    );

    if (activeTabId.value === tabId) {
      activeTabId.value = "";
      activeTabServerId.value = "";
      activeTabServerName.value = "";
      activeTabStatus.value = "disconnected";
    }
  }

  function getAttachmentMimeType(file: File): string {
    if (file.type) return file.type;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const knownTypes: Record<string, string> = {
      avif: "image/avif",
      bmp: "image/bmp",
      gif: "image/gif",
      heic: "image/heic",
      heif: "image/heif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      svg: "image/svg+xml",
      webp: "image/webp",
      aac: "audio/aac",
      flac: "audio/flac",
      m4a: "audio/mp4",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      wav: "audio/wav",
      avi: "video/x-msvideo",
      mkv: "video/x-matroska",
      mov: "video/quicktime",
      mp4: "video/mp4",
      mpeg: "video/mpeg",
      mpg: "video/mpeg",
      webm: "video/webm",
      txt: "text/plain",
      md: "text/markdown",
      json: "application/json",
      csv: "text/csv",
      pdf: "application/pdf",
    };
    return knownTypes[extension] ?? "application/octet-stream";
  }

  function resolveAttachmentModel(
    attachments: Array<Pick<AiAttachment, "name" | "mimeType" | "delivery">>,
  ): { modelName: string; error: string } {
    if (attachments.length === 0) return { modelName: "", error: "" };

    const aiSettings = settingsStore.appSettings.ai;
    const inlineAttachments = attachments.filter(
      attachment => attachment.delivery !== "chunked",
    );
    const config = resolveAiConfigForAttachments(
      aiSettings.configs,
      aiSettings.activeConfigId,
      aiSettings.multimodalConfigId,
      inlineAttachments,
    );
    if (!config) {
      if (aiSettings.configs.length === 0) {
        return { modelName: "", error: "请先配置可用的 AI 模型。" };
      }
      if (inlineAttachments.length === 0) {
        return { modelName: "", error: "请先选择可用的 AI 文本模型。" };
      }
      const modalityLabels = {
        image: "图片",
        audio: "音频",
        video: "视频",
        pdf: "PDF",
        file: "文件",
      } as const;
      const modality = getAttachmentInputModality(inlineAttachments[0]!);
      return {
        modelName: "",
        error: `当前配置中没有支持${modalityLabels[modality]}输入的模型，请启用对应能力或关联多模态模型。`,
      };
    }

    const modelName = [config.providerName, config.model]
      .filter(Boolean)
      .join(" / ");
    return { modelName, error: "" };
  }

  const attachmentModelName = computed(
    () => resolveAttachmentModel(pendingAttachments.value).modelName,
  );

  function toPlainAiAttachments(attachments: AiAttachment[]): AiAttachment[] {
    return attachments.map(attachment => ({
      id: String(attachment.id || ""),
      name: String(attachment.name),
      mimeType: String(attachment.mimeType),
      size: Number(attachment.size),
      dataUrl: String(attachment.dataUrl),
      delivery: attachment.delivery === "chunked" ? "chunked" : "inline",
    }));
  }

  function getAttachmentDelivery(
    name: string,
    mimeType: string,
    size: number,
  ): AiAttachment["delivery"] {
    return size > AI_TEXT_ATTACHMENT_CHUNK_THRESHOLD_BYTES &&
      isAiTextAttachment({ name, mimeType })
      ? "chunked"
      : "inline";
  }

  function getAttachmentSizeLimitBytes(): number {
    const configuredMb = Number(settingsStore.appSettings.ai.maxAttachmentSizeMb);
    const normalizedMb = Number.isFinite(configuredMb)
      ? Math.min(
          MAX_AI_ATTACHMENT_SIZE_MB,
          Math.max(1, Math.floor(configuredMb)),
        )
      : DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB;
    return normalizedMb * 1024 * 1024;
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error(`${file.name} 读取结果无效`));
      reader.onerror = () =>
        reject(reader.error ?? new Error(`${file.name} 读取失败`));
      reader.readAsDataURL(file);
    });
  }

  async function fileToAttachment(file: File): Promise<AiAttachment> {
    const sizeLimitBytes = getAttachmentSizeLimitBytes();
    if (!file.size || file.size > sizeLimitBytes) {
      throw new Error(
        `${file.name} 超过 ${settingsStore.appSettings.ai.maxAttachmentSizeMb} MB 限制`,
      );
    }
    const mimeType = getAttachmentMimeType(file);
    const dataUrl = await readFileAsDataUrl(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType,
      size: file.size,
      dataUrl: dataUrl.replace(
        /^data:[^;,]+;base64,/,
        `data:${mimeType};base64,`,
      ),
      delivery: getAttachmentDelivery(file.name, mimeType, file.size),
    };
  }

  async function addAttachments(files: File[]): Promise<void> {
    if (isSending.value || files.length === 0) return;
    if (!conversationContextReady.value) {
      error.value = "当前会话关联的服务器未连接，无法添加附件";
      return;
    }
    if (pendingAttachments.value.length + files.length > MAX_AI_ATTACHMENT_COUNT) {
      error.value = `最多添加 ${MAX_AI_ATTACHMENT_COUNT} 个附件`;
      return;
    }
    try {
      const route = resolveAttachmentModel([
        ...pendingAttachments.value,
        ...files.map(file => ({
          name: file.name,
          mimeType: getAttachmentMimeType(file),
          delivery: getAttachmentDelivery(
            file.name,
            getAttachmentMimeType(file),
            file.size,
          ),
        })),
      ]);
      if (route.error) {
        error.value = route.error;
        return;
      }
      const attachments = await Promise.all(files.map(fileToAttachment));
      pendingAttachments.value = [...pendingAttachments.value, ...attachments];
      error.value = "";
    } catch (attachmentError) {
      error.value = attachmentError instanceof Error ? attachmentError.message : String(attachmentError);
    }
  }

  function removeAttachment(index: number): void {
    pendingAttachments.value = pendingAttachments.value.filter((_, itemIndex) => itemIndex !== index);
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
    const attachments = toPlainAiAttachments(pendingAttachments.value);

    if ((!content && attachments.length === 0) || isTabSending(context.tabId)) {
      return;
    }

    if (!context.tabId) {
      error.value = "请先打开一个终端标签页，再使用服务器上下文 AI。";
      return;
    }

    if (!conversationContextReady.value) {
      error.value = "当前会话关联的服务器未连接，请先打开并连接对应服务器。";
      return;
    }

    const attachmentRoute = resolveAttachmentModel(attachments);
    if (attachmentRoute.error) {
      error.value = attachmentRoute.error;
      return;
    }

    error.value = "";
    inputText.value = "";
    pendingAttachments.value = [];
    const requestToken = beginTabRequest(context.tabId);

    const messageContent = content || "请分析这些附件";
    const messageAttachments = createMessageAttachments(attachments);
    const userMessage = createMessage("user", messageContent, messageAttachments);
    const conversation = getActiveConversation(context.tabId);
    if (conversation.title === "新对话" && content) {
      conversation.title = content.slice(0, 40);
    }
    if (!conversation.serverId) conversation.serverId = context.serverId ?? "";
    if (!conversation.serverName) conversation.serverName = context.serverName ?? "未知服务器";
    // 发送给主进程的历史只包含既有对话，避免把当前空占位回复传给模型。
    const requestHistory = toPlainAiHistory(
      getUncompactedHistory(conversation).slice(-HISTORY_LIMIT),
    );
    const requestCompaction = toPlainAiCompaction(conversation.compaction);
    appendMessages(context.tabId, [userMessage]);
    void saveAiAttachments(messageAttachments).catch(saveError => {
      core.writeRendererLog(
        "AI 会话附件保存失败",
        { error: saveError instanceof Error ? saveError.message : String(saveError) },
        "warn",
      );
    });

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
        message: content || "请分析这些附件",
        context: plainContext,
        history: requestHistory,
        compaction: requestCompaction,
        attachments,
      });

      reconcileStreamMessages(context.tabId, activeStreamIds, result.messages);
      mergeCommandCards(context.tabId, result.commandCards);
      updateCompaction(context.tabId, result.compaction);
    } catch (sendError) {
      reconcileStreamMessages(context.tabId, activeStreamIds, []);
      error.value =
        sendError instanceof Error ? sendError.message : String(sendError);
    } finally {
      removeListeners();
      finishTabRequest(context.tabId, requestToken);
    }
  }

  async function runApprovedCommand(card: AiCommandCard): Promise<void> {
    const conversation = activeConversation.value;
    const tabId = activeTabId.value;
    const activeCard = conversation?.commandCards.find(item => item.id === card.id);
    const executableCard = activeCard ? { ...activeCard, tabId } : card;
    const approvalId = executableCard.approvalId;

    if (
      !approvalId ||
      !tabId ||
      isTabSending(tabId) ||
      !conversationContextReady.value
    ) {
      if (!conversationContextReady.value) {
        error.value = "当前会话关联的服务器未连接，无法执行该命令。";
      }
      return;
    }

    const requestToken = beginTabRequest(tabId);

    const activeStreamIds = new Set<string>();
    const removeListeners = attachAiStreamListeners(tabId, activeStreamIds);

    try {
      const result = await core.orbitSSHApi.ai.runApprovedCommand({
        tabId,
        command: executableCard.command,
        approvalId,
      });

      reconcileStreamMessages(tabId, activeStreamIds, result.messages);
      mergeCommandCards(tabId, result.commandCards);
      updateCompaction(tabId, result.compaction);
    } catch (runError) {
      reconcileStreamMessages(tabId, activeStreamIds, []);
      updateCommandCard({
        ...executableCard,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
    } finally {
      removeListeners();
      finishTabRequest(tabId, requestToken);
    }
  }

  async function rejectApproval(card: AiCommandCard): Promise<void> {
    const activeCard = activeConversation.value?.commandCards.find(
      item => item.id === card.id,
    );
    const executableCard = activeCard
      ? { ...activeCard, tabId: activeTabId.value || activeCard.tabId }
      : card;

    if (!executableCard.approvalId) {
      updateCommandCard({ ...executableCard, status: "rejected" });
      return;
    }

    try {
      await core.orbitSSHApi.ai.rejectCommandApproval({
        tabId: executableCard.tabId,
        approvalId: executableCard.approvalId,
      });
    } finally {
      updateCommandCard({ ...executableCard, status: "rejected" });
    }
  }

  async function cancelMessage(context: AiContextInput): Promise<void> {
    if (!context.tabId || !isTabSending(context.tabId)) return;

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
      cancelTabRequest(context.tabId);
    }
  }

  return {
    isPanelOpen,
    mode,
    inputText,
    isSending,
    error,
    pendingAttachments,
    attachmentModelName,
    messages,
    commandCards,
    conversations: conversationHistory,
    activeConversationId,
    activeConversationServerName: computed(
      () => activeConversation.value?.serverName || activeTabServerName.value,
    ),
    conversationContextReady,
    shouldSuggestNewConversation,
    canUseAi,
    togglePanel,
    setMode,
    setActiveTabId,
    getConversation,
    activateConversation,
    renameConversation,
    deleteConversation,
    startNewConversation,
    removeTabSession,
    sendMessage,
    runApprovedCommand,
    rejectApproval,
    cancelMessage,
    addAttachments,
    removeAttachment,
  };
});
