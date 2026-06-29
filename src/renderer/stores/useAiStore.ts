import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  AiCommandCard,
  AiChatResult,
  AiContextInput,
  AiMessage,
  AiMode,
} from "../../shared/ai";
import { useCoreStore } from "./useCoreStore";
import { useSettingsStore } from "./useSettingsStore";

function createMessage(role: AiMessage["role"], content: string): AiMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
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
  const messages = ref<AiMessage[]>([]);
  const commandCards = ref<AiCommandCard[]>([]);

  const canUseAi = computed(() => settingsStore.appSettings.ai.enabled);

  function togglePanel(): void {
    isPanelOpen.value = !isPanelOpen.value;
  }

  function setMode(nextMode: AiMode): void {
    mode.value = nextMode;
  }

  function updateCommandCard(card: AiCommandCard): void {
    commandCards.value = commandCards.value.map(item =>
      item.id === card.id ? card : item,
    );
  }

  function mergeCommandCards(cards: AiCommandCard[]): void {
    const nextCards = [...commandCards.value];

    for (const card of cards) {
      const index = nextCards.findIndex(item => item.id === card.id);

      if (index >= 0) {
        nextCards[index] = card;
      } else {
        nextCards.push(card);
      }
    }

    commandCards.value = nextCards;
  }

  function applyAiChatResult(result: AiChatResult): void {
    const normalizedCards = result.commandCards.map(card => ({
      ...card,
      createdAt:
        card.status === "requires_approval"
          ? result.message.createdAt + 1
          : card.createdAt,
    }));

    messages.value = [...messages.value, result.message];
    mergeCommandCards(normalizedCards);
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
    const assistantPlaceholder = createMessage("assistant", "");
    // 发送给主进程的历史只包含既有对话，避免把当前空占位回复传给模型。
    const requestHistory = toPlainAiHistory(messages.value.slice(-8));
    messages.value = [...messages.value, userMessage, assistantPlaceholder];

    // 监听主进程推送的流式 chunk，实时更新占位消息
    let removeStreamListener = () => {};
    if (core.orbitSSHApi?.ai?.onStreamChunk) {
      removeStreamListener = core.orbitSSHApi.ai.onStreamChunk(event => {
        if (event.tabId !== context.tabId) return;
        const msgs = messages.value;
        const last = msgs[msgs.length - 1];
        if (last && last.id === assistantPlaceholder.id) {
          last.content += event.chunk;
        }
      });
    }

    try {
      const plainContext = toPlainAiContext(context);

      const result = await core.orbitSSHApi.ai.chat({
        tabId: plainContext.tabId,
        mode: mode.value,
        message: content,
        context: plainContext,
        history: requestHistory,
      });

      // 用主进程返回的完整消息替换占位消息（保留流式累积的文本作为兜底）
      const finalContent = result.message.content || assistantPlaceholder.content;
      messages.value = messages.value.map(m =>
        m.id === assistantPlaceholder.id
          ? { ...result.message, content: finalContent }
          : m,
      );
      mergeCommandCards(result.commandCards);
    } catch (sendError) {
      // 失败时移除占位消息
      messages.value = messages.value.filter(m => m.id !== assistantPlaceholder.id);
      error.value =
        sendError instanceof Error ? sendError.message : String(sendError);
    } finally {
      removeStreamListener();
      isSending.value = false;
    }
  }

  async function runApprovedCommand(card: AiCommandCard): Promise<void> {
    const approvalId = card.approvalId;

    if (!approvalId) {
      return;
    }

    updateCommandCard({ ...card, status: "running", error: undefined });
    isSending.value = true;

    // 批准后 AI 可能继续执行 agent loop，也会产生流式回复
    const assistantPlaceholder = createMessage("assistant", "");
    messages.value = [...messages.value, assistantPlaceholder];

    let removeStreamListener = () => {};
    if (core.orbitSSHApi?.ai?.onStreamChunk) {
      removeStreamListener = core.orbitSSHApi.ai.onStreamChunk(event => {
        if (event.tabId !== card.tabId) return;
        const msgs = messages.value;
        const last = msgs[msgs.length - 1];
        if (last && last.id === assistantPlaceholder.id) {
          last.content += event.chunk;
        }
      });
    }

    try {
      const result = await core.orbitSSHApi.ai.runApprovedCommand({
        tabId: card.tabId,
        command: card.command,
        approvalId,
      });

      const finalContent = result.message.content || assistantPlaceholder.content;
      messages.value = messages.value.map(m =>
        m.id === assistantPlaceholder.id
          ? { ...result.message, content: finalContent }
          : m,
      );
      mergeCommandCards(result.commandCards);
    } catch (runError) {
      messages.value = messages.value.filter(m => m.id !== assistantPlaceholder.id);
      updateCommandCard({
        ...card,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
    } finally {
      removeStreamListener();
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
    canUseAi,
    togglePanel,
    setMode,
    sendMessage,
    runApprovedCommand,
    rejectApproval,
    cancelMessage,
  };
});
