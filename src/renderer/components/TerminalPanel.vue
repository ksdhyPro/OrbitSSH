<script setup lang="ts">
import {
  computed,
  nextTick,
  reactive,
  ref,
  watch,
} from "vue";
import arrowDownIcon from "../assets/icons/arrow-down.svg";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import caseSensitiveIcon from "../assets/icons/case-sensitive.svg";
import closeIcon from "../assets/icons/close.svg";
import copyIcon from "../assets/icons/copy.svg";
import pasteIcon from "../assets/icons/paste.svg";
import type { ContextMenuItem } from "../types/context-menu";
import type { TerminalTab } from "../types/terminal";
import { getStatusText } from "../utils/status-text";
import { closeFloatingMenus } from "../utils/floating-menu";
import { resolveMenuPlacement } from "../utils/menu-position";
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

const searchInput = ref<HTMLInputElement | null>(null);
const terminalContextMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  canCopy: false,
  canPaste: false,
});

const terminalContextMenuItems = computed<ContextMenuItem[]>(() => [
  {
    key: "copy",
    label: "复制",
    icon: copyIcon,
    disabled: !terminalContextMenu.canCopy,
  },
  {
    key: "paste",
    label: "粘贴",
    icon: pasteIcon,
    disabled: !terminalContextMenu.canPaste,
  },
]);

// 关闭终端右键菜单，供全局点击和菜单项执行后复用。
function closeTerminalContextMenu(): void {
  terminalContextMenu.open = false;
}

// 打开菜单时同步当前终端选区和剪贴板文本状态，用于禁用无效操作。
async function openTerminalContextMenu(event: MouseEvent): Promise<void> {
  event.preventDefault();
  event.stopPropagation();

  closeFloatingMenus();
  terminalContextMenu.open = true;
  const placement = resolveMenuPlacement(
    { x: event.clientX, y: event.clientY },
    terminalContextMenuItems.value.length,
  );
  terminalContextMenu.x = placement.x;
  terminalContextMenu.y = placement.y;
  terminalContextMenu.canCopy = props.hasActiveTerminalSelection();
  terminalContextMenu.canPaste = false;

  // 剪贴板读取走主进程 IPC，异步返回后再启用粘贴项。
  const canPaste = await props.hasClipboardText();

  if (terminalContextMenu.open) {
    terminalContextMenu.canPaste = canPaste;
  }
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
      <nav class="session-tabs" aria-label="终端标签">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          :class="['session-tab', { active: tab.id === activeTabId }]"
          role="button"
          tabindex="0"
          @click="emit('activateTab', tab.id)"
          @keydown.enter.prevent="emit('activateTab', tab.id)"
          @keydown.space.prevent="emit('activateTab', tab.id)">
          <span>{{ tab.title }}</span>
          <small>{{ getStatusText(tab.status) }}</small>
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
        <p>
          点击左侧服务器会创建终端 Tab，并通过 Main Process 建立 SSH shell。
        </p>
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
      <StatusBar :active-tab-id="activeTabId" />
    </section>
  </section>
</template>
