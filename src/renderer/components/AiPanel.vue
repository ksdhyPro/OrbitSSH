<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import type {
  AiAttachment,
  AiCommandCard,
  AiCommandStatus,
  AiContextInput,
  AiConversationSummary,
  AiMessageAttachment,
  AiMode,
} from "../../shared/ai";
import type { AiModelConfig } from "../../shared/settings";
import { aiApiSpecLabels } from "../../shared/ai-api-format";
import { normalizeAiReasoningValues } from "../../shared/ai-reasoning";
import type { ContextMenuItem } from "../types/context-menu";
import arrowDownIcon from "../assets/icons/arrow-down.svg";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import closeIcon from "../assets/icons/close.svg";
import collapseIcon from "../assets/icons/collapse.svg";
import aiAskIcon from "../assets/icons/ai-ask.svg";
import aiFullIcon from "../assets/icons/ai-full.svg";
import copyIcon from "../assets/icons/copy-ai.svg";
import editIcon from "../assets/icons/edit.svg";
import fileIcon from "../assets/icons/file.svg";
import trashIcon from "../assets/icons/trash.svg";
import { closeFloatingMenus } from "../utils/floating-menu";
import { renderMarkdown } from "../utils/markdown";
import { resolveMenuPlacement } from "../utils/menu-position";
import { copyTextByFallback } from "../utils/clipboard";
import type { ImagePreviewState } from "../types/sftp";
import { PhFile, PhImage } from "@phosphor-icons/vue";
import AiAttachmentPreviewDialog from "./AiAttachmentPreviewDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import FloatingMenu from "./FloatingMenu.vue";
import ImagePreviewDialog from "./ImagePreviewDialog.vue";

type AiPanelMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  completedAt?: number;
  attachments?: AiMessageAttachment[];
};

type ProcessTimelineItem =
  | {
      type: "assistant";
      id: string;
      createdAt: number;
      message: AiPanelMessage;
    }
  | {
      type: "card";
      id: string;
      createdAt: number;
      card: AiCommandCard;
    };

type DisplayTimelineItem =
  | {
      type: "message";
      id: string;
      createdAt: number;
      message: AiPanelMessage;
      streaming: boolean;
    }
  | {
      type: "process";
      id: string;
      createdAt: number;
      items: ProcessTimelineItem[];
      durationMs: number | null;
      running: boolean;
    };

const props = defineProps<{
  open: boolean;
  enabled: boolean;
  mode: AiMode;
  inputText: string;
  isSending: boolean;
  error: string;
  attachments: AiAttachment[];
  attachmentModelName: string;
  messages: AiPanelMessage[];
  commandCards: AiCommandCard[];
  conversations: AiConversationSummary[];
  activeConversationId: string;
  conversationServerName: string;
  conversationContextReady: boolean;
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
  attachFiles: [files: File[]];
  removeAttachment: [index: number];
  stop: [];
  startNewConversation: [];
  selectConversation: [conversationId: string];
  renameConversation: [conversationId: string, title: string];
  deleteConversation: [conversationId: string];
  runApproved: [card: AiCommandCard];
  rejectApproval: [card: AiCommandCard];
  selectModel: [configId: string];
  updateModelReasoning: [value: {
    configId: string;
    reasoningEnabled: boolean;
    reasoningEffort: string;
  }];
}>();

const modeOptions: Array<{ value: AiMode; label: string; icon: string }> = [
  { value: "ask", label: "每次询问", icon: aiAskIcon },
  { value: "full", label: "完全访问", icon: aiFullIcon },
];

const attachmentInputEl = ref<HTMLInputElement | null>(null);
const isConversationHistoryOpen = ref(false);
const editingConversationId = ref("");
const editingConversationTitle = ref("");
const editingConversationTarget = ref<"header" | "history" | null>(null);
const headerRenameInputEl = ref<HTMLInputElement | null>(null);
const conversationHistoryEl = ref<HTMLElement | null>(null);
const conversationHistoryTriggerEl = ref<HTMLButtonElement | null>(null);
const selectedMessageAttachment = ref<AiMessageAttachment | null>(null);

const selectedAttachmentIsImage = computed(() =>
  selectedMessageAttachment.value?.mimeType.toLowerCase().startsWith("image/"),
);
const selectedImagePreview = computed<ImagePreviewState>(() => ({
  tabId: props.context.tabId,
  path: selectedMessageAttachment.value?.name ?? "",
  name: selectedMessageAttachment.value?.name ?? "图片预览",
  dataUrl: selectedMessageAttachment.value?.dataUrl ?? "",
  mimeType: selectedMessageAttachment.value?.mimeType ?? "",
  loading: false,
  error: selectedMessageAttachment.value?.dataUrl
    ? ""
    : "附件内容不可用，可能来自旧版本或本地缓存已被清理。",
}));

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function openMessageAttachment(attachment: AiMessageAttachment): void {
  selectedMessageAttachment.value = attachment;
}

function closeMessageAttachment(): void {
  selectedMessageAttachment.value = null;
}

function downloadSelectedAttachment(): void {
  const attachment = selectedMessageAttachment.value;
  if (!attachment?.dataUrl) return;
  const anchor = document.createElement("a");
  anchor.href = attachment.dataUrl;
  anchor.download = attachment.name;
  anchor.click();
}

const activeConversation = computed(() =>
  props.conversations.find(
    conversation => conversation.id === props.activeConversationId,
  ),
);

function beginConversationRename(
  conversation: AiConversationSummary,
  target: "header" | "history",
): void {
  editingConversationId.value = conversation.id;
  editingConversationTitle.value = conversation.title;
  editingConversationTarget.value = target;
  void nextTick(() => {
    const input = target === "header"
      ? headerRenameInputEl.value
      : conversationHistoryEl.value?.querySelector<HTMLInputElement>(
          ".ai-conversation-history-main input",
        );
    input?.focus();
    input?.select();
  });
}

function cancelConversationRename(): void {
  editingConversationId.value = "";
  editingConversationTitle.value = "";
  editingConversationTarget.value = null;
}

function commitConversationRename(): void {
  const conversationId = editingConversationId.value;
  const title = editingConversationTitle.value.trim();
  if (!conversationId || !title) {
    cancelConversationRename();
    return;
  }

  emit("renameConversation", conversationId, title);
  cancelConversationRename();
}

function openAttachmentPicker(): void {
  if (!props.isSending && props.conversationContextReady) {
    attachmentInputEl.value?.click();
  }
}

function handleAttachmentInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  if (files.length > 0) emit("attachFiles", files);
  input.value = "";
}

function getPastedFileExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  return extensions[mimeType.toLowerCase()] ?? "bin";
}

function normalizePastedFile(file: File, index: number): File {
  if (file.name.trim()) return file;
  const kind = file.type.startsWith("image/") ? "image" : "file";
  const extension = getPastedFileExtension(file.type);
  return new File(
    [file],
    `pasted-${kind}-${Date.now()}-${index + 1}.${extension}`,
    { type: file.type, lastModified: file.lastModified || Date.now() },
  );
}

function dataUrlToPastedImageFile(dataUrl: string): File | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const extension = getPastedFileExtension(match[1]);
    return new File(
      [bytes],
      `pasted-image-${Date.now()}.${extension}`,
      { type: match[1], lastModified: Date.now() },
    );
  } catch {
    return null;
  }
}

async function handleComposePaste(event: ClipboardEvent): Promise<void> {
  if (props.isSending || !props.conversationContextReady) return;
  const clipboard = event.clipboardData;
  if (!clipboard) return;

  const itemFiles = Array.from(clipboard.items)
    .filter(item => item.kind === "file")
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const sourceFiles = itemFiles.length > 0
    ? itemFiles
    : Array.from(clipboard.files);
  if (sourceFiles.length > 0) {
    event.preventDefault();
    emit(
      "attachFiles",
      sourceFiles.map((file, index) => normalizePastedFile(file, index)),
    );
    return;
  }

  // 普通文本继续交给 textarea；系统截图未暴露 File 时再读取 Electron 位图。
  if (clipboard.getData("text/plain")) return;
  event.preventDefault();
  const dataUrl = await window.orbitSSH?.clipboard.readImageDataUrl?.();
  if (!dataUrl) return;
  const imageFile = dataUrlToPastedImageFile(dataUrl);
  if (imageFile) emit("attachFiles", [imageFile]);
}

function toggleConversationHistory(): void {
  isConversationHistoryOpen.value = !isConversationHistoryOpen.value;
}

function selectConversation(conversationId: string): void {
  isConversationHistoryOpen.value = false;
  emit("selectConversation", conversationId);
}

function handleConversationHistoryOutsidePointerDown(event: PointerEvent): void {
  if (!isConversationHistoryOpen.value || !(event.target instanceof Node)) {
    return;
  }

  if (
    conversationHistoryEl.value?.contains(event.target) ||
    conversationHistoryTriggerEl.value?.contains(event.target)
  ) {
    return;
  }

  if (editingConversationTarget.value === "history") {
    commitConversationRename();
  }
  isConversationHistoryOpen.value = false;
}

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
  full: "除高风险命令均自动执行",
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

// ----- 模型与推理选择 -----
const modelSelectionMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  anchorTop: 0,
  anchorRight: 0,
});

const MODEL_SELECTION_MENU_WIDTH = 520;
const MODEL_SELECTION_MENU_HEIGHT = 390;
const cascadeProviderGroupId = ref("");

const activeModelConfig = computed(() =>
  props.configs.find(config => config.id === props.activeConfigId) ?? null,
);

const modelProviderGroups = computed(() => {
  const groups = new Map<string, { id: string; name: string; configs: AiModelConfig[] }>();
  for (const config of props.configs) {
    const id = JSON.stringify([config.provider, config.providerName, config.baseUrl]);
    const group = groups.get(id) ?? { id, name: config.providerName, configs: [] };
    group.configs.push(config);
    groups.set(id, group);
  }
  return [...groups.values()];
});

const activeProviderGroup = computed(() =>
  modelProviderGroups.value.find(group =>
    group.configs.some(config => config.id === activeModelConfig.value?.id),
  ) ?? null,
);

const cascadeProviderGroup = computed(() =>
  modelProviderGroups.value.find(group => group.id === cascadeProviderGroupId.value) ??
  activeProviderGroup.value ??
  modelProviderGroups.value[0] ??
  null,
);

const reasoningEffortLabels: Record<string, string> = {
  minimal: "最低",
  low: "轻度",
  medium: "中等",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

const reasoningEffortValues = computed(() => {
  const current = activeModelConfig.value?.reasoningEffort.trim();
  return normalizeAiReasoningValues([
    ...(activeModelConfig.value?.reasoningEffortOptions ?? []),
    current,
  ]);
});

const currentModelLabel = computed(() => {
  return activeModelConfig.value?.model ?? "选择模型";
});

const currentProviderLabel = computed(() =>
  activeProviderGroup.value?.name ?? "选择供应商",
);

const currentReasoningLabel = computed(() => {
  const config = activeModelConfig.value;
  if (!config?.reasoningParameter) return "模型默认";
  if (!config.reasoningEnabled) return "推理关闭";
  return reasoningEffortLabels[config.reasoningEffort] ?? config.reasoningEffort;
});

function positionModelSelectionMenu(): void {
  modelSelectionMenu.x = Math.max(
    8,
    Math.min(
      window.innerWidth - MODEL_SELECTION_MENU_WIDTH - 8,
      modelSelectionMenu.anchorRight - MODEL_SELECTION_MENU_WIDTH,
    ),
  );
  modelSelectionMenu.y = Math.max(
    8,
    modelSelectionMenu.anchorTop - MODEL_SELECTION_MENU_HEIGHT - 8,
  );
}

function closeModelSelectionMenu(): void {
  modelSelectionMenu.open = false;
}

function openModelSelectionMenu(event: MouseEvent): void {
  event.stopPropagation();

  if (modelSelectionMenu.open) {
    closeModelSelectionMenu();
    return;
  }

  if (props.configs.length === 0) {
    return;
  }

  closeFloatingMenus();
  const triggerRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  modelSelectionMenu.anchorTop = triggerRect.top;
  modelSelectionMenu.anchorRight = triggerRect.right;
  cascadeProviderGroupId.value = activeProviderGroup.value?.id ?? modelProviderGroups.value[0]?.id ?? "";
  positionModelSelectionMenu();
  modelSelectionMenu.open = true;
}

function selectModel(configId: string): void {
  closeModelSelectionMenu();
  emit("selectModel", configId);
}

function previewProvider(groupId: string): void {
  cascadeProviderGroupId.value = groupId;
}

function selectReasoning(reasoningEffort: string, reasoningEnabled = true): void {
  const config = activeModelConfig.value;
  if (!config?.reasoningParameter) return;

  emit("updateModelReasoning", {
    configId: config.id,
    reasoningEnabled,
    reasoningEffort,
  });
  closeModelSelectionMenu();
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
  cancelled: "已终止",
  requires_approval: "等待批准",
  rejected: "已拒绝",
};

// 正在流式接收中的 assistant 消息 ID 集合，用于添加打字光标。
// agent loop 串行执行，同一时刻只有最后一条 assistant 消息在流式。
const streamingMessageIds = computed(() => {
  if (!props.isSending) return new Set<string>();
  const lastAssistant = props.messages
    .filter(m => m.role === "assistant")
    .at(-1);
  return lastAssistant ? new Set([lastAssistant.id]) : new Set<string>();
});

const hasPendingApproval = computed(() =>
  props.commandCards.some(card => card.status === "requires_approval"),
);

const hasRunningCommand = computed(() =>
  props.commandCards.some(
    card => card.status === "running" || card.status === "pending",
  ),
);

// 是否显示底部总体状态条：发送中、有命令执行中、或有待批准命令。
const hasStatusBar = computed(
  () => props.isSending || hasRunningCommand.value || hasPendingApproval.value,
);

const pendingApprovalCard = computed(
  () =>
    props.commandCards.find(card => card.status === "requires_approval") ??
    null,
);

function isExecutionAssistantMessage(message: AiPanelMessage): boolean {
  return /^执行[:：]/.test(message.content.trim());
}

// 预先按用户消息分组，在线性扫描中确定每轮最后一条结论，避免对每条消息
// 反复查找下一条用户消息、后续助手消息和命令卡片导致 O(n²) 重算。
const assistantConclusionIds = computed<Set<string>>(() => {
  const events = [
    ...props.messages.map(message => ({
      kind: "message" as const,
      createdAt: message.createdAt,
      message,
    })),
    ...props.commandCards.map(card => ({
      kind: "card" as const,
      createdAt: card.createdAt,
      card,
    })),
  ].sort((left, right) => left.createdAt - right.createdAt);
  const assistantsByTurn = new Map<number, AiPanelMessage[]>();
  const cardsByTurn = new Map<number, AiCommandCard[]>();
  let turn = 0;

  for (const event of events) {
    if (event.kind === "message" && event.message.role !== "assistant") {
      turn += 1;
      continue;
    }

    if (event.kind === "card") {
      const cards = cardsByTurn.get(turn) ?? [];
      cards.push(event.card);
      cardsByTurn.set(turn, cards);
      continue;
    }

    const assistants = assistantsByTurn.get(turn) ?? [];
    assistants.push(event.message);
    assistantsByTurn.set(turn, assistants);
  }

  const conclusionIds = new Set<string>();
  for (const [turnId, assistants] of assistantsByTurn) {
    const candidates = assistants.filter(
      message =>
        message.content.trim() && !isExecutionAssistantMessage(message),
    );
    const conclusion = candidates.at(-1);
    if (!conclusion) continue;

    const hasLaterCommand = (cardsByTurn.get(turnId) ?? []).some(
      card => card.createdAt >= conclusion.createdAt,
    );
    if (!hasLaterCommand) {
      conclusionIds.add(conclusion.id);
    }
  }

  return conclusionIds;
});

function createProcessGroupId(items: ProcessTimelineItem[]): string {
  return `process-${items.map(item => item.id).join("-")}`;
}

function pushProcessGroup(
  timeline: DisplayTimelineItem[],
  items: ProcessTimelineItem[],
  options: { turnStartedAt: number | null; completedAt?: number } = {
    turnStartedAt: null,
  },
): void {
  if (items.length === 0) {
    return;
  }

  const running = items.some(
    item => item.type === "card" && item.card.status === "running",
  );
  const durationMs =
    typeof options.completedAt === "number" &&
    typeof options.turnStartedAt === "number"
      ? Math.max(0, options.completedAt - options.turnStartedAt)
      : null;

  timeline.push({
    type: "process",
    id: createProcessGroupId(items),
    createdAt: items[0]?.createdAt ?? Date.now(),
    items: [...items],
    durationMs,
    running,
  });
  items.length = 0;
}

// 只把用户消息和每轮最终结论作为聊天块；中间解释和命令卡片统一收进过程行。
const timelineItems = computed<DisplayTimelineItem[]>(() => {
  const rawItems = [
    ...props.messages.map(message => ({
      type: "message" as const,
      id: message.id,
      createdAt: message.createdAt,
      message,
    })),
    ...props.commandCards
      .filter(card => card.status !== "requires_approval")
      .map(card => ({
        type: "card" as const,
        id: card.id,
        createdAt: card.createdAt,
        card,
      })),
  ].sort((a, b) => a.createdAt - b.createdAt);
  const timeline: DisplayTimelineItem[] = [];
  const processItems: ProcessTimelineItem[] = [];
  let currentTurnStartedAt: number | null = null;

  for (const item of rawItems) {
    if (item.type === "card") {
      processItems.push(item);
      continue;
    }

    const isUserMessage = item.message.role !== "assistant";
    const shouldShowAsMessage =
      isUserMessage || assistantConclusionIds.value.has(item.message.id);

    if (shouldShowAsMessage) {
      const isAssistantMessage = item.message.role === "assistant";
      pushProcessGroup(timeline, processItems, {
        turnStartedAt: currentTurnStartedAt,
        completedAt: isAssistantMessage
          ? (item.message.completedAt ?? item.message.createdAt)
          : undefined,
      });
      timeline.push({
        ...item,
        type: "message",
        streaming: streamingMessageIds.value.has(item.message.id),
      });

      if (item.message.role !== "assistant") {
        currentTurnStartedAt = item.message.createdAt;
      }
      continue;
    }

    if (item.message.content.trim()) {
      processItems.push({
        type: "assistant",
        id: item.id,
        createdAt: item.createdAt,
        message: item.message,
      });
    }
  }

  pushProcessGroup(timeline, processItems, {
    turnStartedAt: currentTurnStartedAt,
  });
  return timeline;
});

const timelineRenderLimit = ref(120);
const renderedTimelineItems = computed(() =>
  timelineItems.value.slice(-timelineRenderLimit.value),
);
const hasHiddenOlderTimelineItems = computed(
  () => timelineRenderLimit.value < timelineItems.value.length,
);

function showOlderTimelineItems(): void {
  timelineRenderLimit.value = Math.min(
    timelineItems.value.length,
    timelineRenderLimit.value + 120,
  );
}

watch(
  () => props.activeConversationId,
  () => {
    timelineRenderLimit.value = 120;
    selectedMessageAttachment.value = null;
  },
);

const copiedMessageId = ref<string | null>(null);
let copiedMessageTimer: ReturnType<typeof setTimeout> | null = null;

async function copyAssistantMessage(message: AiPanelMessage): Promise<void> {
  if (!message.content) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(message.content);
    } else if (!copyTextByFallback(message.content)) {
      throw new Error("复制失败");
    }

    copiedMessageId.value = message.id;
    if (copiedMessageTimer) {
      clearTimeout(copiedMessageTimer);
    }
    copiedMessageTimer = setTimeout(() => {
      copiedMessageId.value = null;
      copiedMessageTimer = null;
    }, 1500);
  } catch {
    // 剪贴板权限被拒绝时不打断对话，仅恢复按钮状态。
    copiedMessageId.value = null;
  }
}

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
  const cancelled = props.commandCards.filter(
    card => card.status === "cancelled",
  ).length;

  if (failed > 0 || waiting > 0 || rejected > 0 || cancelled > 0) {
    return `处理完成，${completed} 条完成，${failed} 条失败，${cancelled} 条终止，${rejected} 条已拒绝`;
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
  () => {
    const lastMessage = props.messages.at(-1);
    const lastCard = props.commandCards.at(-1);
    return [
      props.messages.length,
      lastMessage?.id ?? "",
      lastMessage?.content.length ?? 0,
      props.commandCards.length,
      lastCard?.id ?? "",
      lastCard?.status ?? "",
    ] as const;
  },
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

// 出现待批准命令时滚动到底部，确保批准按钮可见。
watch(
  () => hasPendingApproval.value,
  hasPending => {
    if (hasPending && isNearMessageBottom()) {
      void scheduleScrollToBottom("smooth");
    }
  },
);

onMounted(() => {
  document.addEventListener(
    "pointerdown",
    handleConversationHistoryOutsidePointerDown,
    true,
  );
});

onBeforeUnmount(() => {
  document.removeEventListener(
    "pointerdown",
    handleConversationHistoryOutsidePointerDown,
    true,
  );
  if (scrollFrameId) {
    cancelAnimationFrame(scrollFrameId);
  }

  if (focusFrameId) {
    cancelAnimationFrame(focusFrameId);
  }

  if (compositionFrameId) {
    cancelAnimationFrame(compositionFrameId);
  }

  if (copiedMessageTimer) {
    clearTimeout(copiedMessageTimer);
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

  if (card.status === "cancelled") {
    return "已终止";
  }

  if (card.status === "completed" || card.status === "failed") {
    return card.approvalId ? "已批准" : "自动审批";
  }

  return "待处理";
}

function getProcessSummary(items: ProcessTimelineItem[]): string {
  const commandCount = items.filter(item => item.type === "card").length;
  const assistantCount = items.filter(item => item.type === "assistant").length;
  const runningCount = items.filter(
    item => item.type === "card" && item.card.status === "running",
  ).length;
  const failedCount = items.filter(
    item => item.type === "card" && item.card.status === "failed",
  ).length;
  const rejectedCount = items.filter(
    item => item.type === "card" && item.card.status === "rejected",
  ).length;
  const cancelledCount = items.filter(
    item => item.type === "card" && item.card.status === "cancelled",
  ).length;

  if (runningCount > 0) {
    return `执行过程：${commandCount} 条命令，正在处理`;
  }

  if (failedCount > 0 || rejectedCount > 0 || cancelledCount > 0) {
    return `执行过程：${commandCount} 条命令，${failedCount} 条失败，${cancelledCount} 条终止，${rejectedCount} 条已拒绝`;
  }

  if (commandCount > 0) {
    return `执行过程：${commandCount} 条命令已完成`;
  }

  return `思考过程：${assistantCount} 条中间说明`;
}

function getProcessItemTitle(item: ProcessTimelineItem): string {
  if (item.type === "assistant") {
    return "中间说明";
  }

  return `${getCommandAuditText(item.card)} · ${statusLabels[item.card.status]}`;
}

function getProcessMemoKey(item: Extract<DisplayTimelineItem, { type: "process" }>): string {
  return item.items
    .map(processItem => {
      if (processItem.type === "assistant") {
        return `${processItem.id}:${processItem.message.content.length}`;
      }
      return `${processItem.id}:${processItem.card.status}:${processItem.card.result?.stdout.length ?? 0}:${processItem.card.result?.stderr.length ?? 0}:${processItem.card.error?.length ?? 0}`;
    })
    .join("|");
}

function getProcessDurationText(
  item: Extract<DisplayTimelineItem, { type: "process" }>,
): string | null {
  if (item.running) {
    return "执行中";
  }

  return typeof item.durationMs === "number"
    ? `用时 ${formatDuration(item.durationMs)}`
    : null;
}

// 把毫秒格式化为人类可读的耗时：
// < 1 分钟 →「x秒」；< 1 小时 →「x分钟x秒」；≥ 1 小时 →「x小时x分钟x秒」（超过 24 小时仍按累计小时显示）。
function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "未知";
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0
      ? `${totalMinutes}分钟${seconds}秒`
      : `${totalMinutes}分钟`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0
    ? `${hours}小时${minutes}分钟${seconds}秒`
    : `${hours}小时${seconds}秒`;
}

function formatConversationTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
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
        <div class="ai-panel-heading">
          <div class="ai-current-conversation-title">
            <input
              v-if="editingConversationTarget === 'header'"
              ref="headerRenameInputEl"
              v-model="editingConversationTitle"
              type="text"
              maxlength="80"
              aria-label="会话名称"
              @keydown.enter.prevent="commitConversationRename"
              @keydown.esc.prevent="cancelConversationRename"
              @blur="commitConversationRename" />
            <template v-else>
              <h2 :title="activeConversation?.title || 'AI 助手'">
                {{ activeConversation?.title || "AI 助手" }}
              </h2>
              <button
                v-if="activeConversation"
                type="button"
                class="ai-current-conversation-edit"
                title="修改当前会话名称"
                aria-label="修改当前会话名称"
                @click="beginConversationRename(activeConversation, 'header')">
                <img :src="editIcon" alt="" />
              </button>
            </template>
          </div>
          <p>{{ conversationServerName || context.serverName || "未选择服务器" }}</p>
        </div>
        <div class="ai-panel-header-actions">
          <button
            ref="conversationHistoryTriggerEl"
            type="button"
            class="ai-history-btn"
            title="历史会话"
            aria-label="历史会话"
            :disabled="conversations.length === 0"
            @click="toggleConversationHistory">
            历史
          </button>
          <button
            type="button"
            class="ai-new-conversation-btn"
            title="新对话"
            :disabled="
              isSending ||
              hasPendingApproval ||
              hasRunningCommand ||
              !context.tabId ||
              !conversationContextReady
            "
            @click="emit('startNewConversation')">
            新对话
          </button>
          <button type="button" title="收起面板" @click="emit('toggle')">
            <img :src="collapseIcon" alt="收起" />
          </button>
        </div>
      </header>

      <div
        v-if="isConversationHistoryOpen"
        ref="conversationHistoryEl"
        class="ai-conversation-history">
        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          :class="[
            'ai-conversation-history-item',
            { active: conversation.id === activeConversationId },
          ]">
          <div class="ai-conversation-history-main">
            <input
              v-if="
                editingConversationTarget === 'history' &&
                editingConversationId === conversation.id
              "
              v-model="editingConversationTitle"
              type="text"
              maxlength="80"
              aria-label="会话名称"
              @click.stop
              @keydown.enter.prevent="commitConversationRename"
              @keydown.esc.prevent="cancelConversationRename"
              @blur="commitConversationRename" />
            <button
              v-else
              type="button"
              class="ai-conversation-history-select"
              @click="selectConversation(conversation.id)">
              <span>
                <strong>{{ conversation.title }}</strong>
                <small>{{ conversation.serverName || "未知服务器" }}</small>
              </span>
              <span class="ai-conversation-history-meta">
                {{ conversation.messageCount }} 条 · {{ formatConversationTime(conversation.updatedAt) }}
              </span>
            </button>
          </div>
          <div class="ai-conversation-history-actions">
            <button
              type="button"
              title="修改会话名称"
              aria-label="修改会话名称"
              @click.stop="beginConversationRename(conversation, 'history')">
              <img :src="editIcon" alt="" />
            </button>
            <button
              type="button"
              class="danger"
              title="删除会话"
              aria-label="删除会话"
              @click.stop="emit('deleteConversation', conversation.id)">
              <img :src="trashIcon" alt="" />
            </button>
          </div>
        </div>
      </div>

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

        <button
          v-if="hasHiddenOlderTimelineItems"
          type="button"
          class="ai-load-older-btn"
          @click="showOlderTimelineItems">
          加载更早消息
        </button>

        <template v-for="item in renderedTimelineItems" :key="item.id">
          <article
            v-if="
              item.type === 'message' &&
              (
                item.message.role !== 'assistant' ||
                item.message.content ||
                item.message.attachments?.length
              )
            "
            v-memo="[
              item.id,
              item.message.content.length,
              item.message.attachments?.map(attachment => Boolean(attachment.dataUrl)).join(''),
              item.streaming,
            ]"
            :class="[
              'ai-message',
              item.message.role,
              { streaming: streamingMessageIds.has(item.message.id) },
            ]">
            <header class="ai-message-header">
              <strong>{{ item.message.role === "user" ? "你" : "AI" }}</strong>
              <button
                v-if="item.message.role === 'assistant'"
                type="button"
                class="ai-copy-btn"
                :title="copiedMessageId === item.message.id ? '已复制' : '复制'"
                :aria-label="
                  copiedMessageId === item.message.id ? '已复制' : '复制'
                "
                @click="copyAssistantMessage(item.message)">
                <span
                  v-if="copiedMessageId === item.message.id"
                  class="ai-copy-success"
                  >✓</span
                >
                <img v-else :src="copyIcon" alt="" />
              </button>
            </header>
            <div
              v-if="item.message.role === 'assistant'"
              class="ai-markdown"
              v-html="renderMarkdown(item.message.content)"></div>
            <p v-else>{{ item.message.content }}</p>
            <div
              v-if="item.message.attachments?.length"
              class="ai-message-attachments">
              <button
                v-for="attachment in item.message.attachments"
                :key="attachment.id"
                type="button"
                class="ai-message-attachment"
                :title="`预览 ${attachment.name}`"
                @click="openMessageAttachment(attachment)">
                <span class="ai-message-attachment-preview">
                  <img
                    v-if="attachment.mimeType.startsWith('image/') && attachment.dataUrl"
                    :src="attachment.dataUrl"
                    :alt="attachment.name" />
                  <PhImage
                    v-else-if="attachment.mimeType.startsWith('image/')"
                    :size="20"
                    aria-hidden="true" />
                  <PhFile v-else :size="20" aria-hidden="true" />
                </span>
                <span class="ai-message-attachment-meta">
                  <strong>{{ attachment.name }}</strong>
                  <small>
                    {{ formatAttachmentSize(attachment.size) }}
                    <template v-if="attachment.delivery === 'chunked'"> · 分段读取</template>
                    <template v-if="!attachment.dataUrl"> · 内容不可用</template>
                  </small>
                </span>
              </button>
            </div>
          </article>

          <details
            v-else-if="item.type === 'process'"
            v-memo="[item.id, getProcessMemoKey(item)]"
            class="ai-process-line"
            :open="item.running">
            <summary>
              <span>{{ getProcessSummary(item.items) }}</span>
              <span
                v-if="getProcessDurationText(item)"
                class="ai-process-duration">
                {{ getProcessDurationText(item) }}
              </span>
            </summary>
            <div class="ai-process-content">
              <section
                v-for="processItem in item.items"
                :key="processItem.id"
                class="ai-process-item">
                <header>
                  <span>{{ getProcessItemTitle(processItem) }}</span>
                </header>

                <div
                  v-if="processItem.type === 'assistant'"
                  class="ai-process-markdown"
                  v-html="renderMarkdown(processItem.message.content)"></div>

                <template v-else>
                  <code>{{ processItem.card.command }}</code>
                  <p>{{ processItem.card.reason }}</p>
                  <details
                    v-if="processItem.card.result || processItem.card.error"
                    class="ai-command-output">
                    <summary>输出</summary>
                    <pre
                      v-if="processItem.card.result?.stdout"
                      class="ai-stdout"
                      >{{ processItem.card.result.stdout }}</pre
                    >
                    <pre
                      v-if="processItem.card.result?.stderr"
                      class="ai-stderr"
                      >{{ processItem.card.result.stderr }}</pre
                    >
                    <p v-if="processItem.card.result" class="ai-exit-meta">
                      退出码：{{ processItem.card.result.exitCode ?? "未知" }}
                    </p>
                    <pre v-if="processItem.card.error" class="ai-stderr">{{
                      processItem.card.error
                    }}</pre>
                  </details>
                </template>
              </section>
            </div>
          </details>
        </template>

        <div v-if="hasStatusBar" class="ai-status-bar">
          <span
            v-if="processStatusText === '处理中...'"
            class="ai-loading-dots"
            aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
          {{ processStatusText }}
        </div>
      </section>

      <footer class="ai-compose">
        <article v-if="pendingApprovalCard" class="ai-approval-popover">
          <header>
            <span>需要确认</span>
            <strong>{{ statusLabels[pendingApprovalCard.status] }}</strong>
          </header>
          <code>{{ pendingApprovalCard.command }}</code>
          <p>{{ pendingApprovalCard.reason }}</p>
          <div class="ai-command-actions">
            <button
              type="button"
              @click="emit('runApproved', pendingApprovalCard)">
              批准执行
            </button>
            <button
              type="button"
              class="secondary"
              @click="emit('rejectApproval', pendingApprovalCard)">
              拒绝
            </button>
          </div>
        </article>
        <p v-if="error" class="ai-error">{{ error }}</p>
        <p v-if="!conversationContextReady" class="ai-session-context-hint">
          当前会话关联的服务器未连接，历史内容可查看，发送前请打开并连接对应服务器。
        </p>
        <input
          ref="attachmentInputEl"
          class="ai-attachment-input"
          type="file"
          multiple
          @change="handleAttachmentInput" />
        <div v-if="attachments.length > 0" class="ai-attachment-list">
          <span v-for="(attachment, index) in attachments" :key="`${attachment.name}-${index}`" class="ai-attachment-chip">
            <img :src="fileIcon" alt="" />
            <span>{{ attachment.name }}</span>
            <small v-if="attachment.delivery === 'chunked'">分段读取</small>
            <button
              type="button"
              :title="`移除 ${attachment.name}`"
              :aria-label="`移除 ${attachment.name}`"
              :disabled="isSending"
              @click="emit('removeAttachment', index)">
              ×
            </button>
          </span>
        </div>
        <p
          v-if="attachments.length > 0 && attachmentModelName"
          class="ai-attachment-route">
          附件将使用 {{ attachmentModelName }}
        </p>
        <textarea
          ref="composeInputEl"
          :value="inputText"
          rows="3"
          placeholder="向 AI 询问这台服务器..."
          :disabled="isSending || !conversationContextReady"
          @input="
            emit(
              'updateInputText',
              ($event.target as HTMLTextAreaElement).value,
            )
          "
          @compositionstart="handleComposeCompositionStart"
          @compositionend="handleComposeCompositionEnd"
          @paste="handleComposePaste"
          @keydown.enter.exact="handleComposeEnterKeydown"></textarea>
        <div class="ai-compose-actions">
          <button
            type="button"
            class="ai-attachment-btn"
            title="添加图片或文件"
            aria-label="添加图片或文件"
            :disabled="isSending || !conversationContextReady"
            @click="openAttachmentPicker">
            <img :src="fileIcon" alt="" />
          </button>
          <button
            type="button"
            class="ai-mode-trigger"
            data-floating-menu-trigger
            :title="currentModeOption.label"
            :disabled="isSending || !conversationContextReady"
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
            class="ai-model-selection-trigger"
            data-floating-menu-trigger
            :title="`${currentModelLabel} · ${currentReasoningLabel}`"
            :disabled="isSending || configs.length === 0"
            @click="openModelSelectionMenu">
            <span class="ai-model-selection-copy">
              <strong>{{ currentModelLabel }}</strong>
              <small>{{ currentReasoningLabel }}</small>
            </span>
            <img :src="arrowDownIcon" alt="" />
          </button>
          <FloatingMenu
            :open="modelSelectionMenu.open"
            :x="modelSelectionMenu.x"
            :y="modelSelectionMenu.y"
            class="ai-model-selection-menu"
            role="menu"
            @close="closeModelSelectionMenu">
            <header class="ai-model-selection-header">
              <span>
                <strong>选择模型</strong>
                <small>{{ currentProviderLabel }} / {{ currentModelLabel }}</small>
              </span>
              <small>{{ activeModelConfig ? aiApiSpecLabels[activeModelConfig.spec] : "未配置 API 格式" }}</small>
            </header>
            <div class="ai-model-cascade">
              <aside class="ai-model-cascade-providers" aria-label="供应商">
                <button
                  v-for="group in modelProviderGroups"
                  :key="group.id"
                  type="button"
                  :class="['ai-provider-option', { active: group.id === cascadeProviderGroup?.id }]"
                  :aria-pressed="group.id === cascadeProviderGroup?.id"
                  @mouseenter="previewProvider(group.id)"
                  @focus="previewProvider(group.id)"
                  @click="previewProvider(group.id)">
                  <span>
                    <strong>{{ group.name }}</strong>
                    <small>{{ group.configs.length }} 个模型</small>
                  </span>
                  <img :src="chevronRightIcon" alt="" />
                </button>
              </aside>
              <section class="ai-model-cascade-models" aria-label="模型">
                <header>
                  <strong>{{ cascadeProviderGroup?.name || "模型" }}</strong>
                  <small>选择后立即用于当前会话</small>
                </header>
                <div class="ai-model-selection-scroll">
                  <button
                    v-for="config in cascadeProviderGroup?.configs ?? []"
                    :key="config.id"
                    type="button"
                    :class="['ai-model-option', { active: config.id === activeConfigId }]"
                    @click="selectModel(config.id)">
                    <span>
                      <strong>{{ config.model }}</strong>
                      <small>
                        {{ config.contextWindow.toLocaleString() }} 上下文
                        <template v-if="config.supportsAttachments"> · 多模态</template>
                      </small>
                    </span>
                    <i aria-hidden="true">{{ config.id === activeConfigId ? "✓" : "" }}</i>
                  </button>
                </div>
              </section>
            </div>
            <footer class="ai-model-cascade-reasoning">
              <span>
                <strong>思考强度</strong>
                <small>{{ currentReasoningLabel }}</small>
              </span>
              <div>
                <button
                  type="button"
                  :class="['ai-reasoning-option', { active: !activeModelConfig?.reasoningEnabled }]"
                  :disabled="!activeModelConfig?.reasoningParameter"
                  @click="selectReasoning(activeModelConfig?.reasoningEffort ?? '', false)">
                  关闭
                </button>
              <button
                v-for="effort in reasoningEffortValues"
                :key="effort"
                type="button"
                :class="[
                  'ai-reasoning-option',
                  {
                    active:
                      activeModelConfig?.reasoningEnabled &&
                      activeModelConfig.reasoningEffort === effort,
                  },
                ]"
                :disabled="!activeModelConfig?.reasoningParameter"
                @click="selectReasoning(effort)">
                {{ reasoningEffortLabels[effort] ?? effort }}
              </button>
              </div>
            </footer>
          </FloatingMenu>
          <button
            v-if="!isSending"
            type="button"
            class="ai-action-btn"
            title="发送"
            :disabled="!inputText.trim() && attachments.length === 0"
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

  <ImagePreviewDialog
    :open="Boolean(selectedMessageAttachment && selectedAttachmentIsImage)"
    :image-preview="selectedImagePreview"
    @close="closeMessageAttachment"
    @download="downloadSelectedAttachment" />
  <AiAttachmentPreviewDialog
    v-if="selectedMessageAttachment && !selectedAttachmentIsImage"
    :attachment="selectedMessageAttachment"
    @close="closeMessageAttachment" />
</template>
