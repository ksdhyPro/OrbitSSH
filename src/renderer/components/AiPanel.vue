<script setup lang="ts">
import type { AiCommandCard, AiContextInput, AiMode } from "../../shared/ai";

defineProps<{
  open: boolean;
  enabled: boolean;
  mode: AiMode;
  inputText: string;
  isSending: boolean;
  error: string;
  messages: { id: string; role: string; content: string }[];
  commandCards: AiCommandCard[];
  context: AiContextInput;
}>();

const emit = defineEmits<{
  toggle: [];
  setMode: [mode: AiMode];
  updateInputText: [value: string];
  send: [];
  runReadonly: [card: AiCommandCard];
  requestApproval: [card: AiCommandCard];
  runApproved: [card: AiCommandCard];
}>();

const modeOptions: Array<{ value: AiMode; label: string }> = [
  { value: "suggest", label: "Suggest" },
  { value: "readonly", label: "Readonly" },
  { value: "approval", label: "Approval" },
];

function formatOutput(card: AiCommandCard): string {
  const result = card.result;

  if (!result) {
    return "";
  }

  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}
</script>

<template>
  <aside :class="['ai-panel', { collapsed: !open }]">
    <button
      v-if="!open"
      type="button"
      class="ai-rail"
      title="AI Assistant"
      @click="emit('toggle')">
      AI
    </button>

    <template v-else>
      <header class="ai-panel-header">
        <div>
          <h2>AI Assistant</h2>
          <p>{{ context.serverName || "No server" }}</p>
        </div>
        <button type="button" title="Collapse" @click="emit('toggle')">
          ×
        </button>
      </header>

      <div class="ai-mode-tabs" aria-label="AI mode">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          :class="{ active: mode === option.value }"
          @click="emit('setMode', option.value)">
          {{ option.label }}
        </button>
      </div>

      <section class="ai-message-list">
        <div v-if="!enabled" class="ai-empty">
          Enable AI in Settings to use OpenAI. Local fallback suggestions still
          work for common diagnostics.
        </div>
        <div v-else-if="messages.length === 0" class="ai-empty">
          Ask about the active server, service status, logs, disk, or next
          command.
        </div>

        <article
          v-for="message in messages"
          :key="message.id"
          :class="['ai-message', message.role]">
          <strong>{{ message.role === "user" ? "You" : "AI" }}</strong>
          <p>{{ message.content }}</p>
        </article>

        <article
          v-for="card in commandCards"
          :key="card.id"
          class="ai-command-card">
          <header>
            <span>{{ card.risk }}</span>
            <strong>{{ card.status }}</strong>
          </header>
          <code>{{ card.command }}</code>
          <p>{{ card.reason }}</p>

          <pre v-if="card.result">{{ formatOutput(card) }}</pre>
          <p v-if="card.error" class="ai-error">{{ card.error }}</p>

          <div class="ai-command-actions">
            <button
              v-if="card.status === 'pending'"
              type="button"
              @click="emit('runReadonly', card)">
              Run
            </button>
            <button
              v-if="card.status === 'requires_approval' && !card.approvalId"
              type="button"
              @click="emit('requestApproval', card)">
              Authorize
            </button>
            <button
              v-if="card.status === 'requires_approval' && card.approvalId"
              type="button"
              @click="emit('runApproved', card)">
              Run approved
            </button>
          </div>
        </article>
      </section>

      <footer class="ai-compose">
        <p v-if="error" class="ai-error">{{ error }}</p>
        <textarea
          :value="inputText"
          rows="3"
          placeholder="Ask AI about this server..."
          @input="
            emit('updateInputText', ($event.target as HTMLTextAreaElement).value)
          "
          @keydown.enter.exact.prevent="emit('send')"></textarea>
        <button
          type="button"
          :disabled="isSending || !inputText.trim()"
          @click="emit('send')">
          {{ isSending ? "Thinking..." : "Send" }}
        </button>
      </footer>
    </template>
  </aside>
</template>
