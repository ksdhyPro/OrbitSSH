<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import closeIcon from "../assets/icons/close.svg";
import continueIcon from "../assets/icons/continue.svg";
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
import ContextMenu from "./ContextMenu.vue";

defineProps<{
  isWindows: boolean;
  isWindowMaximized: boolean;
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
  if (activeHeaderMenu.value !== "tools") {
    return [];
  }

  return [
    {
      key: "data-transfer",
      label: "数据传输",
    },
  ];
});

// 复用通用右键菜单，通过按钮位置计算顶栏下拉菜单坐标。
function openHeaderMenu(menuKey: HeaderMenuKey, event: MouseEvent): void {
  event.stopPropagation();

  const trigger = event.currentTarget;

  if (!(trigger instanceof HTMLElement)) {
    return;
  }

  const rect = trigger.getBoundingClientRect();
  const isSameMenuOpen = headerMenu.open && activeHeaderMenu.value === menuKey;

  if (isSameMenuOpen) {
    closeHeaderMenu();
    return;
  }

  activeHeaderMenu.value = menuKey;
  headerMenu.open = true;
  headerMenu.x = rect.left;
  headerMenu.y = rect.bottom;
}

function closeHeaderMenu(): void {
  headerMenu.open = false;
  activeHeaderMenu.value = null;
}

function selectHeaderMenuItem(item: ContextMenuItem): void {
  closeHeaderMenu();

  if (item.key === "data-transfer") {
    emit("openDataTransfer");
  }
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

onMounted(() => {
  window.addEventListener("click", closeHeaderMenu);
});

onUnmounted(() => {
  window.removeEventListener("click", closeHeaderMenu);
});
</script>

<template>
  <header class="topbar">
    <section class="header-brand">
      <div class="brand-mark">O</div>
      <div>
        <h1>OrbitSSH</h1>
        <!-- <p>SSH Terminal Client</p> -->
      </div>
    </section>
    <nav class="header-menu" aria-label="应用菜单" @click.stop>
      <button
        type="button"
        :class="{ active: activeHeaderMenu === 'tools' && headerMenu.open }"
        @click="openHeaderMenu('tools', $event)">
        工具
      </button>
      <button
        type="button"
        :class="{ active: activeHeaderMenu === 'help' && headerMenu.open }"
        @click="openHeaderMenu('help', $event)">
        帮助
      </button>
      <ContextMenu
        :menu="headerMenu"
        :items="headerMenuItems"
        @select="selectHeaderMenuItem" />
    </nav>
    <div class="titlebar-drag-zone" aria-hidden="true"></div>
    <div class="window-actions">
      <div class="tasklist" @click.stop>
        <button
          type="button"
          class="tasklist-trigger"
          aria-label="传输任务"
          title="传输任务"
          @click="emit('updateTaskListOpen', !isTaskListOpen)">
          <img :src="taskIcon" alt="" />
          <strong v-if="activeDownloadCount > 0">
            {{ activeDownloadCount }}
          </strong>
        </button>
        <section v-if="isTaskListOpen" class="tasklist-panel">
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
                      :disabled="isDownloadTaskOperating(task.taskId)"
                      @click="emit('controlDownloadTask', task, 'resume')">
                      <img :src="continueIcon" alt="继续" />
                    </button>
                    <button
                      v-else
                      title="暂停"
                      type="button"
                      :disabled="isDownloadTaskOperating(task.taskId)"
                      @click="emit('controlDownloadTask', task, 'pause')">
                      <img :src="pauseIcon" alt="暂停" />
                    </button>
                    <button
                      title="删除"
                      type="button"
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
        </section>
      </div>
      <button type="button" aria-label="设置" @click="emit('openSettings')">
        <img :src="settingsIcon" alt="" />
      </button>
      <template v-if="isWindows">
        <span class="window-action-divider"></span>
        <button
          type="button"
          aria-label="最小化窗口"
          @click="emit('minimizeWindow')">
          <img :src="minimizeIcon" alt="" />
        </button>
        <button
          type="button"
          :aria-label="isWindowMaximized ? '还原窗口' : '最大化窗口'"
          @click="emit('toggleMaximizeWindow')">
          <img :src="isWindowMaximized ? restoreIcon : maximizeIcon" alt="" />
        </button>
        <button
          type="button"
          class="window-close"
          aria-label="关闭窗口"
          @click="emit('closeWindow')">
          <img :src="closeIcon" alt="" />
        </button>
      </template>
    </div>
  </header>
</template>
