<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import appIcon from "../assets/icons/app-icon.png";
import closeIcon from "../assets/icons/close.svg";
import continueIcon from "../assets/icons/continue.svg";
import macCloseIcon from "../assets/icons/mac-close.svg";
import macMinimizeIcon from "../assets/icons/mac-minimize.svg";
import macZoomIcon from "../assets/icons/mac-zoom.svg";
import maximizeIcon from "../assets/icons/maximize.svg";
import minimizeIcon from "../assets/icons/minimize.svg";
import pauseIcon from "../assets/icons/pause.svg";
import restoreIcon from "../assets/icons/restore.svg";
import settingsIcon from "../assets/icons/settings.svg";
import taskIcon from "../assets/icons/task.svg";
import trashIcon from "../assets/icons/trash.svg";
import type { DownloadTask } from "../types/download";
import type { ContextMenuItem } from "../types/context-menu";
import { formatFileSize } from "../utils/format";
import {
  getDownloadProgressPercent,
  getDownloadTaskStatusText,
} from "../utils/status-text";
import { closeFloatingMenus } from "../utils/floating-menu";
import { resolveMenuPlacement } from "../utils/menu-position";
import ContextMenu from "./ContextMenu.vue";
import FloatingMenu from "./FloatingMenu.vue";

const props = defineProps<{
  isWindows: boolean;
  isMac: boolean;
  isWindowMaximized: boolean;
  isWindowFullScreen: boolean;
  isTaskListOpen: boolean;
  activeDownloadCount: number;
  visibleDownloadTasks: DownloadTask[];
  isDownloadTaskOperating: (taskId: string) => boolean;
}>();

const emit = defineEmits<{
  updateTaskListOpen: [open: boolean];
  controlDownloadTask: [
    task: DownloadTask,
    action: "pause" | "resume" | "cancel",
  ];
  openDataTransfer: [];
  openSettings: [];
  openUpdate: [];
  openAbout: [];
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
        label: "数据传输",
      },
    ];
  }

  if (activeHeaderMenu.value === "help") {
    return [
      {
        key: "check-update",
        label: "检查更新",
      },
      {
        key: "about",
        label: "关于",
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

  // 检查更新
  if (item.key === "check-update") {
    emit("openUpdate");
    return;
  }

  if (item.key === "about") {
    emit("openAbout");
  }
}

function toggleTaskList(): void {
  if (props.isTaskListOpen) {
    emit("updateTaskListOpen", false);
    return;
  }

  closeFloatingMenus();
  emit("updateTaskListOpen", true);
}

function getTaskDirectionText(task: DownloadTask): string {
  if (task.direction === "upload") {
    return "上传";
  }

  if (task.direction === "server-transfer") {
    return "服务器传输";
  }

  return "下载";
}
</script>

<template>
  <header class="topbar">
    <div
      v-if="isMac && !isWindowFullScreen"
      class="mac-window-controls"
      aria-label="窗口控制">
      <button
        type="button"
        tabindex="-1"
        class="mac-window-control mac-window-close"
        aria-label="关闭窗口"
        @click="emit('closeWindow')">
        <img :src="macCloseIcon" alt="" />
      </button>
      <button
        type="button"
        tabindex="-1"
        class="mac-window-control mac-window-minimize"
        aria-label="最小化窗口"
        @click="emit('minimizeWindow')">
        <img :src="macMinimizeIcon" alt="" />
      </button>
      <button
        type="button"
        tabindex="-1"
        class="mac-window-control mac-window-zoom"
        :aria-label="isWindowMaximized ? '还原窗口' : '最大化窗口'"
        @click="emit('toggleMaximizeWindow')">
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
        @mouseenter="switchHeaderMenuOnHover('tools', $event)">
        工具
      </button>
      <button
        type="button"
        tabindex="-1"
        data-floating-menu-trigger
        :class="{ active: activeHeaderMenu === 'help' && headerMenu.open }"
        @click="openHeaderMenu('help', $event)"
        @mouseenter="switchHeaderMenuOnHover('help', $event)">
        帮助
      </button>
      <ContextMenu
        :menu="headerMenu"
        :items="headerMenuItems"
        @select="selectHeaderMenuItem"
        @close="closeHeaderMenu" />
    </nav>
    <div class="titlebar-drag-zone" aria-hidden="true"></div>
    <div class="window-actions">
      <div class="tasklist" @click.stop>
        <button
          type="button"
          tabindex="-1"
          class="tasklist-trigger"
          data-floating-menu-trigger
          aria-label="传输任务"
          title="传输任务"
          @click="toggleTaskList">
          <img :src="taskIcon" alt="" />
          <strong v-if="activeDownloadCount > 0">
            {{ activeDownloadCount }}
          </strong>
        </button>
        <FloatingMenu
          :open="isTaskListOpen"
          class="tasklist-panel"
          @close="emit('updateTaskListOpen', false)">
          <header>
            <span>传输任务</span>
            <small>{{ visibleDownloadTasks.length }} 项</small>
          </header>
          <div v-if="visibleDownloadTasks.length === 0" class="tasklist-empty">
            暂无传输任务
          </div>
          <template v-else>
            <article
              v-for="task in visibleDownloadTasks"
              :key="task.taskId"
              class="tasklist-item">
              <div class="tasklist-item-head">
                <strong>
                  <span class="tasklist-direction">
                    {{ getTaskDirectionText(task) }}
                  </span>
                  {{ task.name }}
                </strong>
                <small>{{ getDownloadTaskStatusText(task) }}</small>
              </div>
              <div class="tasklist-progress">
                <span
                  :style="{
                    width: `${getDownloadProgressPercent(task)}%`,
                  }"></span>
              </div>

              <div class="tasklist-info">
                <p v-if="task.status === 'error'">{{ task.error }}</p>
                <p v-else>
                  {{ formatFileSize(task.transferredBytes) }}
                  <template v-if="task.totalBytes > 0">
                    / {{ formatFileSize(task.totalBytes) }}
                  </template>
                </p>
                <div class="tasklist-actions">
                  <template
                    v-if="
                      ['started', 'progress', 'paused'].includes(task.status)
                    ">
                    <button
                      v-if="task.status === 'paused'"
                      title="继续"
                      type="button"
                      tabindex="-1"
                      :disabled="isDownloadTaskOperating(task.taskId)"
                      @click="emit('controlDownloadTask', task, 'resume')">
                      <img :src="continueIcon" alt="继续" />
                    </button>
                    <button
                      v-else
                      title="暂停"
                      type="button"
                      tabindex="-1"
                      :disabled="isDownloadTaskOperating(task.taskId)"
                      @click="emit('controlDownloadTask', task, 'pause')">
                      <img :src="pauseIcon" alt="暂停" />
                    </button>
                    <button
                      title="删除"
                      type="button"
                      tabindex="-1"
                      class="danger"
                      :disabled="isDownloadTaskOperating(task.taskId)"
                      @click="emit('controlDownloadTask', task, 'cancel')">
                      <img :src="trashIcon" alt="删除" />
                    </button>
                  </template>
                </div>
              </div>
            </article>
          </template>
        </FloatingMenu>
      </div>
      <button
        type="button"
        tabindex="-1"
        aria-label="设置"
        @click="emit('openSettings')">
        <img :src="settingsIcon" alt="" />
      </button>
      <template v-if="isWindows">
        <span class="window-action-divider"></span>
        <button
          type="button"
          tabindex="-1"
          aria-label="最小化窗口"
          @click="emit('minimizeWindow')">
          <img :src="minimizeIcon" alt="" />
        </button>
        <button
          type="button"
          tabindex="-1"
          :aria-label="isWindowMaximized ? '还原窗口' : '最大化窗口'"
          @click="emit('toggleMaximizeWindow')">
          <img :src="isWindowMaximized ? restoreIcon : maximizeIcon" alt="" />
        </button>
        <button
          type="button"
          tabindex="-1"
          class="window-close"
          aria-label="关闭窗口"
          @click="emit('closeWindow')">
          <img :src="closeIcon" alt="" />
        </button>
      </template>
    </div>
  </header>
</template>
