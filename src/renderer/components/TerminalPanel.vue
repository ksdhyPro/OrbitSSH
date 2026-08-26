<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import arrowDownIcon from "../assets/icons/arrow-down.svg";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import caseSensitiveIcon from "../assets/icons/case-sensitive.svg";
import closeIcon from "../assets/icons/close.svg";
import reconnectIcon from "../assets/icons/reconnect.svg";
import type { ServerAutomationTask } from "../../shared/server";
import type { AutomationTaskRunEvent, AutomationTaskRunStatus } from "../../shared/automation";
import type { ContextMenuItem } from "../types/context-menu";
import type { TerminalTab } from "../types/terminal";
import { getStatusText } from "../utils/status-text";
import { closeFloatingMenus } from "../utils/floating-menu";
import { resolveMenuPlacement } from "../utils/menu-position";
import { useTerminalsStore } from "../stores/useTerminalsStore";
import { useCoreStore } from "../stores/useCoreStore";
import AutomationRunDialog from "./AutomationRunDialog.vue";
import AutomationTaskDialog from "./AutomationTaskDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import StatusBar from "./StatusBar.vue";

const props = defineProps<{
  tabs: TerminalTab[];
  activeTabId: string;
  isTerminalSearchOpen: boolean;
  isTerminalSearchCaseSensitive: boolean;
  terminalSearchKeyword: string;
  terminalSearchResult: {
    index: number;
    total: number;
  };
  setTerminalHost: (tabId: string, element: unknown) => void;
  hasActiveTerminalSelection: () => boolean;
  hasClipboardText: () => boolean | Promise<boolean>;
  copyActiveTerminalSelection: () => void | Promise<void>;
  pasteClipboardTextToActiveTerminal: () => void | Promise<void>;
}>();

const emit = defineEmits<{
  "update:terminalSearchKeyword": [value: string];
  search: [direction?: "current" | "next" | "previous"];
  toggleCaseSensitive: [];
  closeSearch: [];
  activateTab: [tabId: string];
  closeTab: [tabId: string];
  openConnectionDialog: [];
}>();

const terminalsStore = useTerminalsStore();
const core = useCoreStore();

const searchInput = ref<HTMLInputElement | null>(null);
const sessionTabsElement = ref<HTMLElement | null>(null);
const terminalContextMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  canCopy: false,
  canPaste: false,
});
const savedAutomationTasks = ref<ServerAutomationTask[]>([]);
const automationTaskDialog = reactive({
  open: false,
  serverId: "",
  serverName: "",
  error: "",
  isSubmitting: false,
});
const automationTaskForm = reactive({ name: "", script: "" });
const automationRun = reactive<{
  open: boolean;
  task: ServerAutomationTask | null;
  status: AutomationTaskRunStatus;
  output: string;
  error: string;
  runId: string;
}>({ open: false, task: null, status: "confirm", output: "", error: "", runId: "" });

// 标签溢出时将纵向滚轮转换为横向滚动，方便快速切换较多服务器。
function scrollSessionTabs(event: WheelEvent): void {
  const sessionTabs = sessionTabsElement.value;
  if (!sessionTabs || sessionTabs.scrollWidth <= sessionTabs.clientWidth) {
    return;
  }

  const scrollDelta = event.deltaX || event.deltaY;
  if (!scrollDelta) {
    return;
  }

  event.preventDefault();
  sessionTabs.scrollLeft += scrollDelta;
}

const terminalContextMenuItems = computed<ContextMenuItem[]>(() => [
  {
    key: "copy",
    label: "复制",
    disabled: !terminalContextMenu.canCopy,
  },
  {
    key: "paste",
    label: "粘贴",
    disabled: !terminalContextMenu.canPaste,
  },
  {
    key: "automation-tasks",
    label: "自动化任务",
    children: [
      {
        key: "new-automation-task",
        label: "新建任务",
        group: "new-task",
      },
      ...savedAutomationTasks.value.map(task => ({
        key: `automation-task:${task.id}`,
        label: task.name,
        group: "saved-tasks",
      })),
    ],
  },
]);

function getActiveTerminalTab(): TerminalTab | undefined {
  return props.tabs.find(tab => tab.id === props.activeTabId);
}

// 每次打开菜单读取当前服务器的专属命令，新增后立即在子菜单中可见。
async function loadSavedAutomationTasks(): Promise<void> {
  const tab = getActiveTerminalTab();

  if (!tab || !core.orbitSSHApi?.servers.listAutomationTasks) {
    savedAutomationTasks.value = [];
    return;
  }

  try {
    savedAutomationTasks.value = await core.orbitSSHApi.servers.listAutomationTasks(tab.serverId);
  } catch (error) {
    savedAutomationTasks.value = [];
    core.writeRendererLog(
      "加载服务器常用命令失败",
      {
        serverId: tab.serverId,
        error: error instanceof Error ? error.message : String(error),
      },
      "warn",
    );
  }
}

function openAutomationTaskDialog(): void {
  const tab = getActiveTerminalTab();
  if (!tab) {
    return;
  }

  automationTaskForm.name = "";
  automationTaskForm.script = "";
  automationTaskDialog.serverId = tab.serverId;
  automationTaskDialog.serverName = tab.title;
  automationTaskDialog.error = "";
  automationTaskDialog.open = true;
}

function closeAutomationTaskDialog(): void {
  if (automationTaskDialog.isSubmitting) {
    return;
  }

  automationTaskDialog.open = false;
  automationTaskDialog.error = "";
}

async function saveAutomationTask(): Promise<void> {
  const name = automationTaskForm.name.trim();
  const script = automationTaskForm.script.trim();

  if (!name || !script) {
    automationTaskDialog.error = "请填写任务名称和脚本内容";
    return;
  }

  if (!core.orbitSSHApi?.servers.createAutomationTask) {
    automationTaskDialog.error = "自动化任务保存服务不可用，请重启应用后重试";
    return;
  }

  automationTaskDialog.isSubmitting = true;
  automationTaskDialog.error = "";

  try {
    const savedTask = await core.orbitSSHApi.servers.createAutomationTask({
      serverId: automationTaskDialog.serverId,
      name,
      script,
    });
    const activeTab = getActiveTerminalTab();
    if (activeTab?.serverId === savedTask.serverId) {
      savedAutomationTasks.value = [...savedAutomationTasks.value, savedTask];
    }
    automationTaskDialog.open = false;
  } catch (error) {
    automationTaskDialog.error = error instanceof Error ? error.message : "保存自动化任务失败";
  } finally {
    automationTaskDialog.isSubmitting = false;
  }
}

// 关闭终端右键菜单，供全局点击和菜单项执行后复用。
function openAutomationRunDialog(task: ServerAutomationTask): void {
  automationRun.open = true;
  automationRun.task = task;
  automationRun.status = "confirm";
  automationRun.output = "";
  automationRun.error = "";
  automationRun.runId = "";
}

function closeAutomationRunDialog(): void {
  if (automationRun.status === "running") return;
  automationRun.open = false;
  automationRun.task = null;
}

async function startAutomationRun(): Promise<void> {
  if (!automationRun.task || !core.orbitSSHApi?.automation) {
    automationRun.status = "failed";
    automationRun.error = "自动化执行服务不可用，请重启应用后重试";
    return;
  }
  automationRun.status = "running";
  automationRun.output = "";
  automationRun.error = "";
  try {
    const result = await core.orbitSSHApi.automation.run(automationRun.task.id);
    automationRun.runId = result.runId;
  } catch (error) {
    automationRun.status = "failed";
    automationRun.error = error instanceof Error ? error.message : "自动化任务启动失败";
  }
}

async function cancelAutomationRun(): Promise<void> {
  if (!automationRun.runId || !core.orbitSSHApi?.automation) return;
  await core.orbitSSHApi.automation.cancel(automationRun.runId);
}

function handleAutomationRunEvent(event: AutomationTaskRunEvent): void {
  if (event.runId !== automationRun.runId || !automationRun.task) return;
  if (event.type === "output") {
    automationRun.output = `${automationRun.output}${event.text ?? ""}`.slice(-30_000);
    return;
  }
  if (event.type === "completed") automationRun.status = "completed";
  if (event.type === "cancelled") automationRun.status = "cancelled";
  if (event.type === "failed") {
    automationRun.status = "failed";
    automationRun.error = event.text ?? "自动化任务执行失败";
  }
}

let stopAutomationRunEvents: (() => void) | undefined;
onMounted(() => {
  stopAutomationRunEvents = core.orbitSSHApi?.automation?.onRunEvent(handleAutomationRunEvent);
});
onUnmounted(() => stopAutomationRunEvents?.());

function closeTerminalContextMenu(): void {
  terminalContextMenu.open = false;
}

// 打开菜单时同步当前终端选区和剪贴板文本状态，用于禁用无效操作。
async function openTerminalContextMenu(event: MouseEvent): Promise<void> {
  event.preventDefault();
  event.stopPropagation();

  closeFloatingMenus();
  terminalContextMenu.canCopy = props.hasActiveTerminalSelection();
  terminalContextMenu.canPaste = false;
  await Promise.all([
    loadSavedAutomationTasks(),
    Promise.resolve(props.hasClipboardText()).then(canPaste => {
      terminalContextMenu.canPaste = canPaste;
    }),
  ]);

  terminalContextMenu.open = true;
  const placement = resolveMenuPlacement(
    { x: event.clientX, y: event.clientY },
    terminalContextMenuItems.value.length,
  );
  terminalContextMenu.x = placement.x;
  terminalContextMenu.y = placement.y;
}

// 终端菜单只负责触发复制/粘贴命令，具体 xterm 和剪贴板处理留在 store。
async function selectTerminalContextMenuItem(
  item: ContextMenuItem,
): Promise<void> {
  closeTerminalContextMenu();

  if (item.key === "copy") {
    await props.copyActiveTerminalSelection();
  } else if (item.key === "paste") {
    await props.pasteClipboardTextToActiveTerminal();
  } else if (item.key === "new-automation-task") {
    openAutomationTaskDialog();
  } else if (item.key.startsWith("automation-task:")) {
    const taskId = item.key.slice("automation-task:".length);
    const task = savedAutomationTasks.value.find(entry => entry.id === taskId);
    if (task) {
      openAutomationRunDialog(task);
    }
  }
}

// 搜索框内用 Shift+Tab 跳到上一个结果，同时阻止默认回退焦点。
function searchPreviousByBackwardTab(event: KeyboardEvent): void {
  if (!event.shiftKey) {
    return;
  }

  event.preventDefault();
  emit("search", "previous");
}

// 搜索栏显示后在子组件内聚焦，避免父组件直接持有内部 DOM。
watch(
  () => props.isTerminalSearchOpen,
  async isOpen => {
    if (!isOpen) {
      return;
    }

    await nextTick();
    searchInput.value?.focus();
    searchInput.value?.select();
  },
);
</script>

<template>
  <section class="workspace">
    <section class="terminal-area">
      <nav
        ref="sessionTabsElement"
        class="session-tabs"
        role="tablist"
        aria-label="终端标签"
        @wheel="scrollSessionTabs">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          :class="['session-tab', { active: tab.id === activeTabId }]"
          role="tab"
          :aria-selected="tab.id === activeTabId"
          tabindex="0"
          @click="emit('activateTab', tab.id)"
          @keydown.enter.prevent="emit('activateTab', tab.id)"
          @keydown.space.prevent="emit('activateTab', tab.id)">
          <span>{{ tab.title }}</span>
          <small
            :class="{ 'status-disconnected': tab.status === 'disconnected' }"
            >{{ getStatusText(tab.status) }}</small
          >
          <button
            v-if="tab.status === 'disconnected' || tab.status === 'error'"
            type="button"
            class="session-tab-reconnect"
            aria-label="重新连接"
            title="重新连接"
            @click.stop="terminalsStore.reconnectTerminal(tab.id)">
            <img :src="reconnectIcon" alt="" />
          </button>
          <button
            type="button"
            class="session-tab-close"
            aria-label="关闭终端"
            @click.stop="emit('closeTab', tab.id)">
            <img :src="closeIcon" alt="" />
          </button>
        </div>
      </nav>

      <div v-if="isTerminalSearchOpen" class="terminal-search">
        <input
          ref="searchInput"
          :value="terminalSearchKeyword"
          type="search"
          placeholder="搜索终端内容"
          @input="
            emit(
              'update:terminalSearchKeyword',
              ($event.target as HTMLInputElement).value,
            );
            emit('search');
          "
          @keydown.enter.prevent="
            emit('search', $event.shiftKey ? 'previous' : 'next')
          "
          @keydown.tab="searchPreviousByBackwardTab"
          @keydown.esc.prevent="emit('closeSearch')" />
        <span class="terminal-search-count">
          {{ terminalSearchResult.index }}/{{ terminalSearchResult.total }}
        </span>
        <button
          type="button"
          :class="[
            'terminal-search-tool',
            { active: isTerminalSearchCaseSensitive },
          ]"
          aria-label="区分大小写"
          title="区分大小写"
          @click="emit('toggleCaseSensitive')">
          <img :src="caseSensitiveIcon" alt="" />
        </button>
        <button
          type="button"
          class="terminal-search-tool"
          aria-label="上一个"
          title="上一个"
          @click="emit('search', 'previous')">
          <img :src="arrowUpIcon" alt="" />
        </button>
        <button
          type="button"
          class="terminal-search-tool"
          aria-label="下一个"
          title="下一个"
          @click="emit('search', 'next')">
          <img :src="arrowDownIcon" alt="" />
        </button>
        <button
          type="button"
          class="terminal-search-tool"
          aria-label="关闭搜索"
          title="关闭搜索"
          @click="emit('closeSearch')">
          <img :src="closeIcon" alt="" />
        </button>
      </div>

      <div v-if="tabs.length === 0" class="terminal-empty">
        <p class="eyebrow">READY</p>
        <h2>选择服务器开始 SSH 会话</h2>
        <p>点击左侧服务器建立 SSH shell。</p>
        <button type="button" @click="emit('openConnectionDialog')">
          新增连接
        </button>
      </div>
      <div v-else class="terminal-hosts">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          :ref="element => setTerminalHost(tab.id, element)"
          class="terminal-host"
          v-show="tab.id === activeTabId"
          @contextmenu="void openTerminalContextMenu($event)"></div>
      </div>

      <ContextMenu
        :menu="terminalContextMenu"
        :items="terminalContextMenuItems"
        @select="selectTerminalContextMenuItem"
        @close="closeTerminalContextMenu" />
      <AutomationTaskDialog
        :open="automationTaskDialog.open"
        :server-name="automationTaskDialog.serverName"
        :form="automationTaskForm"
        :error="automationTaskDialog.error"
        :is-submitting="automationTaskDialog.isSubmitting"
        @close="closeAutomationTaskDialog"
        @submit="saveAutomationTask" />
      <AutomationRunDialog
        :open="automationRun.open"
        :server-name="getActiveTerminalTab()?.title ?? ''"
        :task="automationRun.task"
        :status="automationRun.status"
        :output="automationRun.output"
        :error="automationRun.error"
        @close="closeAutomationRunDialog"
        @start="startAutomationRun"
        @cancel="cancelAutomationRun" />
      <StatusBar :active-tab-id="activeTabId" />
    </section>
  </section>
</template>
