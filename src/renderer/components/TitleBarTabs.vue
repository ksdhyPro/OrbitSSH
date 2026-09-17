<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import appIcon from "../assets/icons/app-icon.png";
import closeIcon from "../assets/icons/close.svg";
import macCloseIcon from "../assets/icons/mac-close.svg";
import macMinimizeIcon from "../assets/icons/mac-minimize.svg";
import macZoomIcon from "../assets/icons/mac-zoom.svg";
import maximizeIcon from "../assets/icons/maximize.svg";
import minimizeIcon from "../assets/icons/minimize.svg";
import restoreIcon from "../assets/icons/restore.svg";
import settingsIcon from "../assets/icons/settings.svg";
import taskIcon from "../assets/icons/task.svg";
import type { ContextMenuItem } from "../types/context-menu";
import { closeFloatingMenus } from "../utils/floating-menu";
import { resolveMenuPlacement } from "../utils/menu-position";
import ContextMenu from "./ContextMenu.vue";

defineProps<{
  isWindows: boolean;
  isMac: boolean;
  isWindowMaximized: boolean;
  isWindowFullScreen: boolean;
  hasTransferTasks: boolean;
}>();

const emit = defineEmits<{
  openTransferTasks: [];
  openDataTransfer: [];
  openPortForwards: [];
  openSettings: [];
  openUpdate: [];
  openAbout: [];
  openFeedback: [];
  openChangelog: [];
  minimizeWindow: [];
  toggleMaximizeWindow: [];
  closeWindow: [];
}>();

type HeaderMenuKey = "tools" | "help";

const activeHeaderMenu = ref<HeaderMenuKey | null>(null);
const headerMenu = reactive({
  open: false,
  x: 0,
  y: 0,
});

const headerMenuItems = computed<ContextMenuItem[]>(() => {
  if (activeHeaderMenu.value === "tools") {
    return [
      {
        key: "data-transfer",
        label: "文件传输",
      },
      {
        key: "port-forwards",
        label: "端口转发",
      },
    ];
  }

  if (activeHeaderMenu.value === "help") {
    return [
      {
        key: "check-update",
        label: "检查更新",
        group: "update",
      },
      {
        key: "changelog",
        label: "更新日志",
        group: "links",
      },
      {
        key: "feedback",
        label: "提交反馈",
        group: "links",
      },
      {
        key: "about",
        label: "关于",
        group: "about",
      },
    ];
  }

  return [];
});

// 复用通用右键菜单，通过按钮位置计算顶栏下拉菜单坐标。
function activateHeaderMenu(
  menuKey: HeaderMenuKey,
  trigger: HTMLElement,
): void {
  const rect = trigger.getBoundingClientRect();
  const placement = resolveMenuPlacement(
    { x: rect.left, y: rect.bottom },
    headerMenuItems.value.length,
  );

  activeHeaderMenu.value = menuKey;
  headerMenu.open = true;
  headerMenu.x = placement.x;
  headerMenu.y = placement.y;
}

// 点击：首次打开菜单；若点的是当前已打开的同一个菜单则关闭。
function openHeaderMenu(menuKey: HeaderMenuKey, event: MouseEvent): void {
  event.stopPropagation();

  const trigger = event.currentTarget;

  if (!(trigger instanceof HTMLElement)) {
    return;
  }

  const isSameMenuOpen = headerMenu.open && activeHeaderMenu.value === menuKey;

  if (isSameMenuOpen) {
    closeHeaderMenu();
    return;
  }

  closeFloatingMenus();
  activateHeaderMenu(menuKey, trigger);
}

// 菜单栏已打开时，鼠标平移到其他菜单按钮上直接切换（原生菜单栏行为）。
// 未打开时不触发，避免一进入界面 hover 就弹出菜单。
function switchHeaderMenuOnHover(
  menuKey: HeaderMenuKey,
  event: MouseEvent,
): void {
  if (!headerMenu.open || activeHeaderMenu.value === menuKey) {
    return;
  }

  const trigger = event.currentTarget;

  if (!(trigger instanceof HTMLElement)) {
    return;
  }

  activateHeaderMenu(menuKey, trigger);
}

function closeHeaderMenu(): void {
  headerMenu.open = false;
  activeHeaderMenu.value = null;
}

function selectHeaderMenuItem(item: ContextMenuItem): void {
  closeHeaderMenu();

  if (item.key === "data-transfer") {
    emit("openDataTransfer");
    return;
  }

  if (item.key === "port-forwards") {
    emit("openPortForwards");
    return;
  }

  // 检查更新
  if (item.key === "check-update") {
    emit("openUpdate");
    return;
  }

  if (item.key === "changelog") {
    emit("openChangelog");
    return;
  }

  if (item.key === "feedback") {
    emit("openFeedback");
    return;
  }

  if (item.key === "about") {
    emit("openAbout");
  }
}

</script>

<template>
  <header class="topbar">
    <div
      v-if="isMac && !isWindowFullScreen"
      class="mac-window-controls"
      aria-label="窗口控制"
    >
      <button
        type="button"
        tabindex="-1"
        class="mac-window-control mac-window-close"
        aria-label="关闭窗口"
        @click="emit('closeWindow')"
      >
        <img :src="macCloseIcon" alt="" />
      </button>
      <button
        type="button"
        tabindex="-1"
        class="mac-window-control mac-window-minimize"
        aria-label="最小化窗口"
        @click="emit('minimizeWindow')"
      >
        <img :src="macMinimizeIcon" alt="" />
      </button>
      <button
        type="button"
        tabindex="-1"
        class="mac-window-control mac-window-zoom"
        :aria-label="isWindowMaximized ? '还原窗口' : '最大化窗口'"
        @click="emit('toggleMaximizeWindow')"
      >
        <img :src="macZoomIcon" alt="" />
      </button>
    </div>
    <section v-if="!isMac" class="header-brand">
      <img class="brand-mark" :src="appIcon" alt="" />
      <div>
        <h1>OrbitSSH</h1>
        <!-- <p>SSH Terminal Client</p> -->
      </div>
    </section>
    <nav v-if="!isMac" class="header-menu" aria-label="应用菜单" @click.stop>
      <button
        type="button"
        tabindex="-1"
        data-floating-menu-trigger
        :class="{ active: activeHeaderMenu === 'tools' && headerMenu.open }"
        @click="openHeaderMenu('tools', $event)"
        @mouseenter="switchHeaderMenuOnHover('tools', $event)"
      >
        工具
      </button>
      <button
        type="button"
        tabindex="-1"
        data-floating-menu-trigger
        :class="{ active: activeHeaderMenu === 'help' && headerMenu.open }"
        @click="openHeaderMenu('help', $event)"
        @mouseenter="switchHeaderMenuOnHover('help', $event)"
      >
        帮助
      </button>
      <ContextMenu
        class="header-menu-dropdown"
        :menu="headerMenu"
        :items="headerMenuItems"
        @select="selectHeaderMenuItem"
        @close="closeHeaderMenu"
      />
    </nav>
    <div class="titlebar-drag-zone" aria-hidden="true"></div>
    <div class="window-actions">
      <div class="tasklist">
        <button
          type="button"
          tabindex="-1"
          class="tasklist-trigger"
          aria-label="传输任务"
          title="传输任务"
          @click="emit('openTransferTasks')"
        >
          <img :src="taskIcon" alt="" />
          <span v-if="hasTransferTasks" class="tasklist-dot"></span>
        </button>
      </div>
      <button
        type="button"
        tabindex="-1"
        aria-label="设置"
        @click="emit('openSettings')"
      >
        <img :src="settingsIcon" alt="" />
      </button>
      <template v-if="isWindows">
        <span class="window-action-divider"></span>
        <button
          type="button"
          tabindex="-1"
          aria-label="最小化窗口"
          @click="emit('minimizeWindow')"
        >
          <img :src="minimizeIcon" alt="" />
        </button>
        <button
          type="button"
          tabindex="-1"
          :aria-label="isWindowMaximized ? '还原窗口' : '最大化窗口'"
          @click="emit('toggleMaximizeWindow')"
        >
          <img :src="isWindowMaximized ? restoreIcon : maximizeIcon" alt="" />
        </button>
        <button
          type="button"
          tabindex="-1"
          class="window-close"
          aria-label="关闭窗口"
          @click="emit('closeWindow')"
        >
          <img :src="closeIcon" alt="" />
        </button>
      </template>
    </div>
  </header>
</template>
