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
    messages.value = [...messages.value, userMessage];

    try {
      const plainContext = toPlainAiContext(context);

      const result = await core.orbitSSHApi.ai.chat({
        tabId: plainContext.tabId,
        mode: mode.value,
        message: content,
        context: plainContext,
        history: toPlainAiHistory(messages.value.slice(-10)),
      });

      applyAiChatResult(result);
    } catch (sendError) {
      error.value =
        sendError instanceof Error ? sendError.message : String(sendError);
    } finally {
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

    try {
      const result = await core.orbitSSHApi.ai.runApprovedCommand({
        tabId: card.tabId,
        command: card.command,
        approvalId,
      });
      applyAiChatResult(result);
    } catch (runError) {
      updateCommandCard({
        ...card,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
    } finally {
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
  };
});
