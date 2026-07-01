<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import type {
  AiCommandCard,
  AiCommandStatus,
  AiContextInput,
  AiMode,
} from "../../shared/ai";
import type { AiModelConfig } from "../../shared/settings";
import type { ContextMenuItem } from "../types/context-menu";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import closeIcon from "../assets/icons/close.svg";
import collapseIcon from "../assets/icons/collapse.svg";
import aiAskIcon from "../assets/icons/ai-ask.svg";
import aiAutoIcon from "../assets/icons/ai-auto.svg";
import aiFullIcon from "../assets/icons/ai-full.svg";
import { closeFloatingMenus } from "../utils/floating-menu";
import { renderMarkdown } from "../utils/markdown";
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
  shouldSuggestNewConversation: boolean;
  context: AiContextInput;
  configs: AiModelConfig[];
  activeConfigId: string;
}>();

const emit = defineEmits<{
  toggle: [];
  setMode: [mode: AiMode];
  updateInputText: [value: string];
  send: [];
  stop: [];
  startNewConversation: [];
  runApproved: [card: AiCommandCard];
  rejectApproval: [card: AiCommandCard];
  selectModel: [configId: string];
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
    desc: modeDescs[opt.value],
  })),
);

const modeDescs: Record<AiMode, string> = {
  ask: "所有命令均会询问确认",
  auto: "常规命令自动执行",
  full: "除高危命令均自动执行",
};

const currentModeOption = computed(
  () => modeOptions.find(opt => opt.value === props.mode)!,
);

function closeModeMenu(): void {
  modeMenu.open = false;
}

function openModeMenu(event: MouseEvent): void {
  event.stopPropagation();

  // 如果菜单已打开，点击按钮关闭（toggle 行为）
  if (modeMenu.open) {
    closeModeMenu();
    return;
  }

  closeFloatingMenus();
  const placement = resolveMenuPlacement(
    { x: event.clientX, y: event.clientY },
    modeMenuItems.value.length,
  );
  modeMenu.x = placement.x;
  modeMenu.y = placement.y;
  modeMenu.open = true;
}

function selectMode(item: ContextMenuItem): void {
  closeModeMenu();
  emit("setMode", item.key as AiMode);
}

// ----- 模型切换 -----
const modelMenu = reactive({
  open: false,
  x: 0,
  y: 0,
});

const modelMenuItems = computed<ContextMenuItem[]>(() =>
  props.configs.map(config => ({
    key: config.id,
    label: config.model,
    desc: config.baseUrl,
  })),
);

const currentModelLabel = computed(() => {
  const active = props.configs.find(
    config => config.id === props.activeConfigId,
  );
  return active?.model ?? "选择模型";
});

function closeModelMenu(): void {
  modelMenu.open = false;
}

function openModelMenu(event: MouseEvent): void {
  event.stopPropagation();

  if (modelMenu.open) {
    closeModelMenu();
    return;
  }

  // 没有可用模型时不展开，避免空菜单
  if (props.configs.length === 0) {
    return;
  }

  closeFloatingMenus();
  const placement = resolveMenuPlacement(
    { x: event.clientX, y: event.clientY },
    modelMenuItems.value.length,
  );
  modelMenu.x = placement.x;
  modelMenu.y = placement.y;
  modelMenu.open = true;
}

function selectModel(item: ContextMenuItem): void {
  closeModelMenu();
  emit("selectModel", item.key);
}

// 面板展开时，若当前选中的模型已失效（被删除或从未设置），默认落到第一个配置。
watch(
  () => props.open,
  isOpen => {
    if (!isOpen) return;
    const exists = props.configs.some(
      config => config.id === props.activeConfigId,
    );
    if (!exists && props.configs.length > 0) {
      emit("selectModel", props.configs[0].id);
    }
  },
);

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

// 正在流式接收中的最后一条 assistant 消息 ID，用于添加打字光标
const streamingMessageId = computed(() => {
  if (!props.isSending) return null;
  const assistantMessages = props.messages.filter(m => m.role === "assistant");
  return assistantMessages.at(-1)?.id ?? null;
});

const hasProcess = computed(
  () => props.isSending || props.commandCards.length > 0,
);

const hasPendingApproval = computed(() =>
  props.commandCards.some(card => card.status === "requires_approval"),
);

const hasRunningCommand = computed(() =>
  props.commandCards.some(
    card => card.status === "running" || card.status === "pending",
  ),
);

const isProcessExpanded = ref(false);

const processCreatedAt = computed(() => {
  const latestCardTime = Math.max(
    0,
    ...props.commandCards.map(card => card.createdAt),
  );
  const latestMessageTime = Math.max(
    0,
    ...props.messages.map(message => message.createdAt),
  );

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
  const failed = props.commandCards.filter(
    card => card.status === "failed",
  ).length;
  const rejected = props.commandCards.filter(
    card => card.status === "rejected",
  ).length;

  if (failed > 0 || waiting > 0 || rejected > 0) {
    return `处理完成，${completed} 条完成，${failed} 条失败，${rejected} 条已拒绝`;
  }

  return "处理完成";
});

// ----- 自动滚动到最新消息 -----

const messageListEl = ref<HTMLElement | null>(null);
const composeInputEl = ref<HTMLTextAreaElement | null>(null);
const isComposingInput = ref(false);
let scrollFrameId = 0;
let focusFrameId = 0;
let compositionFrameId = 0;

function isNearMessageBottom(): boolean {
  const el = messageListEl.value;
  if (!el) return true;

  // 用户停留在底部附近时才自动跟随，避免查看历史消息时被新内容拉回底部。
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(behavior: ScrollBehavior = "auto"): void {
  const el = messageListEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior });
}

async function scheduleScrollToBottom(
  behavior: ScrollBehavior = "auto",
): Promise<void> {
  await nextTick();
  if (scrollFrameId) {
    cancelAnimationFrame(scrollFrameId);
  }

  // 等浏览器完成文本换行和卡片高度计算后再滚动到底部。
  scrollFrameId = requestAnimationFrame(() => {
    scrollFrameId = 0;
    scrollToBottom(behavior);
  });
}

async function scheduleFocusComposeInput(): Promise<void> {
  await nextTick();
  if (focusFrameId) {
    cancelAnimationFrame(focusFrameId);
  }

  // 等输入框解除禁用状态并完成渲染后，再把焦点放回底部输入框。
  focusFrameId = requestAnimationFrame(() => {
    focusFrameId = 0;
    if (!props.open || props.isSending) return;
    composeInputEl.value?.focus();
  });
}

function handleComposeCompositionStart(): void {
  if (compositionFrameId) {
    cancelAnimationFrame(compositionFrameId);
    compositionFrameId = 0;
  }

  isComposingInput.value = true;
}

function handleComposeCompositionEnd(): void {
  if (compositionFrameId) {
    cancelAnimationFrame(compositionFrameId);
  }

  // macOS 中文输入法确认候选词时可能紧跟 Enter 事件，延后一帧再释放组合态。
  compositionFrameId = requestAnimationFrame(() => {
    compositionFrameId = 0;
    isComposingInput.value = false;
  });
}

function handleComposeEnterKeydown(event: KeyboardEvent): void {
  // 输入法组词/选词期间，Enter 应交给 IME 确认候选词，不能触发发送。
  if (isComposingInput.value || event.isComposing || event.keyCode === 229) {
    return;
  }

  event.preventDefault();
  emit("send");
}

// 消息、流式文本或命令卡片有变化时，在贴底状态下继续跟随最新内容。
watch(
  () => [
    props.messages.map(message => `${message.id}:${message.content.length}`).join("|"),
    props.commandCards
      .map(card => `${card.id}:${card.status}:${card.reason.length}`)
      .join("|"),
  ] as const,
  () => {
    if (isNearMessageBottom()) {
      void scheduleScrollToBottom();
    }
  },
);

watch(
  () => props.isSending,
  (sending, wasSending) => {
    // 发送开始后稍作等待，确保 AI 回复区域的 DOM 已插入再滚动。
    if (sending) {
      setTimeout(() => {
        void scheduleScrollToBottom("smooth");
      }, 80);
    }

    if (wasSending && !sending) {
      void scheduleFocusComposeInput();
    }
  },
);

// 展开/收起过程卡片时重新滚动，确保内容可见
watch(
  () => isProcessExpanded.value,
  () => {
    if (isNearMessageBottom()) {
      void scheduleScrollToBottom("smooth");
    }
  },
);

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

onBeforeUnmount(() => {
  if (scrollFrameId) {
    cancelAnimationFrame(scrollFrameId);
  }

  if (focusFrameId) {
    cancelAnimationFrame(focusFrameId);
  }

  if (compositionFrameId) {
    cancelAnimationFrame(compositionFrameId);
  }
});

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
        <div class="ai-panel-header-actions">
          <button
            type="button"
            class="ai-new-conversation-btn"
            title="新对话"
            :disabled="
              isSending || hasPendingApproval || hasRunningCommand || !context.tabId
            "
            @click="emit('startNewConversation')">
            新对话
          </button>
          <button type="button" title="收起面板" @click="emit('toggle')">
            <img :src="collapseIcon" alt="收起" />
          </button>
        </div>
      </header>

      <section
        ref="messageListEl"
        class="ai-message-list"
        :aria-busy="isSending">
        <div v-if="!enabled" class="ai-empty">
          请先在设置中启用 AI 后再使用所选 AI 服务。常见诊断仍会提供本地建议。
        </div>
        <div v-else-if="messages.length === 0" class="ai-empty">
          可以询问当前服务器、服务状态、日志、磁盘空间或下一步命令。请注意AI回复具有不确定性，请谨慎执行命令。
        </div>
        <div
          v-else-if="shouldSuggestNewConversation"
          class="ai-empty ai-conversation-hint">
          当前对话较长，建议新建对话以减少历史干扰。
        </div>

        <template v-for="item in timelineItems" :key="item.id">
          <article
            v-if="
              item.type === 'message' &&
              (item.message.role !== 'assistant' || item.message.content)
            "
            :class="[
              'ai-message',
              item.message.role,
              { streaming: item.message.id === streamingMessageId },
            ]">
            <strong>{{ item.message.role === "user" ? "你" : "AI" }}</strong>
            <div
              v-if="item.message.role === 'assistant'"
              class="ai-markdown"
              v-html="renderMarkdown(item.message.content)">
            </div>
            <p v-else>{{ item.message.content }}</p>
          </article>

          <section
            v-if="item.type === 'process'"
            :class="['ai-process', { expanded: isProcessExpanded }]">
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
          ref="composeInputEl"
          :value="inputText"
          rows="3"
          placeholder="向 AI 询问这台服务器..."
          :disabled="isSending"
          @input="
            emit(
              'updateInputText',
              ($event.target as HTMLTextAreaElement).value,
            )
          "
          @compositionstart="handleComposeCompositionStart"
          @compositionend="handleComposeCompositionEnd"
          @keydown.enter.exact="handleComposeEnterKeydown"></textarea>
        <div class="ai-compose-actions">
          <button
            type="button"
            class="ai-mode-trigger"
            data-floating-menu-trigger
            :title="currentModeOption.label"
            :disabled="isSending"
            @click="openModeMenu">
            <img :src="currentModeOption.icon" alt="" />
            <span>{{ currentModeOption.label }}</span>
          </button>
          <ContextMenu
            :menu="modeMenu"
            :items="modeMenuItems"
            @select="selectMode"
            @close="closeModeMenu" />
          <button
            type="button"
            class="ai-mode-trigger ai-model-trigger"
            data-floating-menu-trigger
            :title="currentModelLabel"
            :disabled="isSending || configs.length === 0"
            @click="openModelMenu">
            <span class="ai-model-trigger-label">{{ currentModelLabel }}</span>
          </button>
          <ContextMenu
            :menu="modelMenu"
            :items="modelMenuItems"
            @select="selectModel"
            @close="closeModelMenu" />
          <button
            v-if="!isSending"
            type="button"
            class="ai-action-btn"
            title="发送"
            :disabled="!inputText.trim()"
            @click="emit('send')">
            <img :src="arrowUpIcon" alt="发送" />
          </button>
          <button
            v-else
            type="button"
            class="ai-action-btn ai-stop-btn"
            title="终止"
            @click="emit('stop')">
            <img :src="closeIcon" alt="终止" />
          </button>
        </div>
      </footer>
    </template>
  </aside>
</template>
