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

function createMessage(role: AiMessage["role"], content: string): AiMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
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

  async function sendMessage(context: AiContextInput): Promise<void> {
    const content = inputText.value.trim();

    if (!content || isSending.value) {
      return;
    }

    if (!context.tabId) {
      error.value = "Open a terminal tab before using server-aware AI.";
      return;
    }

    error.value = "";
    inputText.value = "";
    isSending.value = true;

    const userMessage = createMessage("user", content);
    messages.value = [...messages.value, userMessage];

    try {
      const result = await core.orbitSSHApi.ai.chat({
        tabId: context.tabId,
        mode: mode.value,
        message: content,
        context,
        history: messages.value.slice(-10),
      });

      messages.value = [...messages.value, result.message];
      commandCards.value = [...result.commandCards, ...commandCards.value];

      if (
        settingsStore.appSettings.ai.allowReadonlyAutoRun &&
        mode.value === "readonly"
      ) {
        for (const card of result.commandCards) {
          if (card.status === "pending") {
            await runReadonlyCommand(card);
          }
        }
      }
    } catch (sendError) {
      error.value =
        sendError instanceof Error ? sendError.message : String(sendError);
    } finally {
      isSending.value = false;
    }
  }

  async function runReadonlyCommand(card: AiCommandCard): Promise<void> {
    updateCommandCard({ ...card, status: "running", error: undefined });

    try {
      const result = await core.orbitSSHApi.ai.runReadonlyCommand(
        card.tabId,
        card.command,
      );
      updateCommandCard({ ...card, status: "completed", result });
    } catch (runError) {
      updateCommandCard({
        ...card,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
    }
  }

  async function requestApproval(card: AiCommandCard): Promise<void> {
    try {
      const approvedCard = await core.orbitSSHApi.ai.requestCommandApproval({
        tabId: card.tabId,
        command: card.command,
        reason: card.reason,
        risk: card.risk,
      });
      updateCommandCard({ ...card, approvalId: approvedCard.approvalId });
    } catch (approvalError) {
      updateCommandCard({
        ...card,
        status: "failed",
        error:
          approvalError instanceof Error
            ? approvalError.message
            : String(approvalError),
      });
    }
  }

  async function runApprovedCommand(card: AiCommandCard): Promise<void> {
    if (!card.approvalId) {
      await requestApproval(card);
      const refreshedCard = commandCards.value.find(item => item.id === card.id);

      if (!refreshedCard?.approvalId) {
        return;
      }

      card = refreshedCard;
    }

    const approvalId = card.approvalId;

    if (!approvalId) {
      return;
    }

    updateCommandCard({ ...card, status: "running", error: undefined });

    try {
      const result = await core.orbitSSHApi.ai.runApprovedCommand({
        tabId: card.tabId,
        command: card.command,
        approvalId,
      });
      updateCommandCard({ ...card, status: "completed", result });
    } catch (runError) {
      updateCommandCard({
        ...card,
        status: "failed",
        error: runError instanceof Error ? runError.message : String(runError),
      });
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
    runReadonlyCommand,
    requestApproval,
    runApprovedCommand,
  };
});
