<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  AiCommandCard,
  AiCommandStatus,
  AiContextInput,
  AiMode,
} from "../../shared/ai";
import type { ContextMenuItem } from "../types/context-menu";
import collapseIcon from "../assets/icons/collapse.svg";
import aiAskIcon from "../assets/icons/ai-ask.svg";
import aiAutoIcon from "../assets/icons/ai-auto.svg";
import aiFullIcon from "../assets/icons/ai-full.svg";
import { closeFloatingMenus } from "../utils/floating-menu";
import { resolveMenuPlacement } from "../utils/menu-position";
import ContextMenu from "./ContextMenu.vue";

const props = defineProps<{
  open: boolean;
  enabled: boolean;
  mode: AiMode;
  inputText: string;
  isSending: boolean;
  error: string;
  messages: { id: string; role: string; content: string; createdAt: number }[];
  commandCards: AiCommandCard[];
  context: AiContextInput;
}>();

const emit = defineEmits<{
  toggle: [];
  setMode: [mode: AiMode];
  updateInputText: [value: string];
  send: [];
  runApproved: [card: AiCommandCard];
  rejectApproval: [card: AiCommandCard];
}>();

const modeOptions: Array<{ value: AiMode; label: string; icon: string }> = [
  { value: "ask", label: "每次询问", icon: aiAskIcon },
  { value: "auto", label: "自动审批", icon: aiAutoIcon },
  { value: "full", label: "完全访问", icon: aiFullIcon },
];

const modeMenu = reactive({
  open: false,
  x: 0,
  y: 0,
});

const modeMenuItems = computed<ContextMenuItem[]>(() =>
  modeOptions.map(opt => ({
    key: opt.value,
    label: opt.label,
    icon: opt.icon,
  })),
);

const currentModeOption = computed(() =>
  modeOptions.find(opt => opt.value === props.mode)!,
);

function closeModeMenu(): void {
  modeMenu.open = false;
}

function openModeMenu(event: MouseEvent): void {
  event.stopPropagation();
  closeFloatingMenus();
  modeMenu.open = true;
  const placement = resolveMenuPlacement(
    { x: event.clientX, y: event.clientY },
    modeMenuItems.value.length,
  );
  modeMenu.x = placement.x;
  modeMenu.y = placement.y;
}

function selectMode(item: ContextMenuItem): void {
  closeModeMenu();
  emit("setMode", item.key as AiMode);
}

const statusLabels: Record<AiCommandStatus, string> = {
  suggested: "建议命令",
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  requires_approval: "等待批准",
  rejected: "已拒绝",
};

const sortedCommandCards = computed(() =>
  [...props.commandCards].sort((a, b) => a.createdAt - b.createdAt),
);

const hasProcess = computed(
  () => props.isSending || props.commandCards.length > 0,
);

const hasPendingApproval = computed(() =>
  props.commandCards.some(card => card.status === "requires_approval"),
);

const hasRunningCommand = computed(() =>
  props.commandCards.some(card => card.status === "running" || card.status === "pending"),
);

const isProcessExpanded = ref(false);

const processCreatedAt = computed(() => {
  const latestCardTime = Math.max(
    0,
    ...props.commandCards.map(card => card.createdAt),
  );
  const latestMessageTime = Math.max(0, ...props.messages.map(message => message.createdAt));

  if (latestCardTime > 0) {
    return latestCardTime;
  }

  return props.isSending ? latestMessageTime + 1 : latestMessageTime;
});

const timelineItems = computed(() =>
  [
    ...props.messages.map(message => ({
      type: "message" as const,
      id: message.id,
      createdAt: message.createdAt,
      message,
    })),
    ...(hasProcess.value
      ? [
          {
            type: "process" as const,
            id: "ai-process",
            createdAt: processCreatedAt.value,
          },
        ]
      : []),
  ].sort((a, b) => a.createdAt - b.createdAt),
);

const processStatusText = computed(() => {
  if (hasPendingApproval.value) {
    return "等待批准";
  }

  if (props.isSending || hasRunningCommand.value) {
    return "处理中...";
  }

  const waiting = props.commandCards.filter(
    card => card.status === "requires_approval",
  ).length;
  const completed = props.commandCards.filter(
    card => card.status === "completed",
  ).length;
  const failed = props.commandCards.filter(card => card.status === "failed").length;
  const rejected = props.commandCards.filter(card => card.status === "rejected").length;

  if (failed > 0 || waiting > 0 || rejected > 0) {
    return `处理完成，${completed} 条完成，${failed} 条失败，${rejected} 条已拒绝`;
  }

  return "处理完成";
});

watch(
  () => hasPendingApproval.value,
  hasPending => {
    if (hasPending) {
      isProcessExpanded.value = true;
    } else if (hasRunningCommand.value || props.isSending) {
      isProcessExpanded.value = false;
    }
  },
);

function getCommandAuditText(card: AiCommandCard): string {
  if (card.status === "requires_approval") {
    return "请求批准";
  }

  if (card.status === "running") {
    return "处理中";
  }

  if (card.status === "rejected") {
    return "已拒绝";
  }

  if (card.status === "completed" || card.status === "failed") {
    return card.approvalId ? "已批准" : "自动审批";
  }

  return "待处理";
}
</script>

<template>
  <aside :class="['ai-panel', { collapsed: !open }]">
    <button
      v-if="!open"
      type="button"
      class="ai-rail"
      title="AI 助手"
      @click="emit('toggle')">
      AI
    </button>

    <template v-else>
      <header class="ai-panel-header">
        <div>
          <h2>AI 助手</h2>
          <p>{{ context.serverName || "未选择服务器" }}</p>
        </div>
        <button type="button" title="收起面板" @click="emit('toggle')">
          <img :src="collapseIcon" alt="收起" />
        </button>
      </header>

      <section class="ai-message-list" :aria-busy="isSending">
        <div v-if="!enabled" class="ai-empty">
          请先在设置中启用 AI 后再使用所选 AI 服务。常见诊断仍会提供本地建议。
        </div>
        <div v-else-if="messages.length === 0" class="ai-empty">
          可以询问当前服务器、服务状态、日志、磁盘空间或下一步命令。
        </div>

        <template v-for="item in timelineItems" :key="item.id">
          <article
            v-if="item.type === 'message'"
            :class="['ai-message', item.message.role]">
            <strong>{{ item.message.role === "user" ? "你" : "AI" }}</strong>
            <p>{{ item.message.content }}</p>
          </article>

          <section v-else :class="['ai-process', { expanded: isProcessExpanded }]">
            <button
              type="button"
              class="ai-process-toggle"
              @click="isProcessExpanded = !isProcessExpanded">
              <span>
                <span
                  v-if="processStatusText === '处理中...'"
                  class="ai-loading-dots"
                  aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
                {{ processStatusText }}
              </span>
              <strong>{{ isProcessExpanded ? "收起" : "查看过程" }}</strong>
            </button>

            <div v-if="isProcessExpanded" class="ai-process-body">
              <article
                v-for="card in sortedCommandCards"
                :key="card.id"
                class="ai-command-card">
                <header>
                  <span>{{ getCommandAuditText(card) }}</span>
                  <strong>{{ statusLabels[card.status] }}</strong>
                </header>
                <code>{{ card.command }}</code>
                <p>{{ card.reason }}</p>

                <div class="ai-command-actions">
                  <button
                    v-if="card.status === 'requires_approval'"
                    type="button"
                    @click="emit('runApproved', card)">
                    批准执行
                  </button>
                  <button
                    v-if="card.status === 'requires_approval'"
                    type="button"
                    class="secondary"
                    @click="emit('rejectApproval', card)">
                    拒绝
                  </button>
                </div>
              </article>
            </div>
          </section>
        </template>

      </section>

      <footer class="ai-compose">
        <p v-if="error" class="ai-error">{{ error }}</p>
        <textarea
          :value="inputText"
          rows="3"
          placeholder="向 AI 询问这台服务器..."
          :disabled="isSending"
          @input="
            emit('updateInputText', ($event.target as HTMLTextAreaElement).value)
          "
          @keydown.enter.exact.prevent="emit('send')"></textarea>
        <div class="ai-compose-actions">
          <button
            type="button"
            class="ai-mode-trigger"
            data-floating-menu-trigger
            :title="currentModeOption.label"
            :disabled="isSending"
            @click="openModeMenu">
            <img :src="currentModeOption.icon" alt="" />
          </button>
          <ContextMenu
            :menu="modeMenu"
            :items="modeMenuItems"
            @select="selectMode"
            @close="closeModeMenu" />
          <button
            type="button"
            class="ai-send-btn"
            :disabled="isSending || !inputText.trim()"
            @click="emit('send')">
            {{ isSending ? "思考中..." : "发送" }}
          </button>
        </div>
      </footer>
    </template>
  </aside>
</template>
