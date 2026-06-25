<script setup lang="ts">
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
import type { TerminalTab } from "../types/terminal";
import { formatFileSize } from "../utils/format";
import {
  getDownloadProgressPercent,
  getDownloadTaskStatusText,
  getStatusText,
} from "../utils/status-text";

defineProps<{
  tabs: TerminalTab[];
  activeTabId: string;
  isWindowMaximized: boolean;
  isTaskListOpen: boolean;
  activeDownloadCount: number;
  visibleDownloadTasks: DownloadTask[];
  isDownloadTaskOperating: (taskId: string) => boolean;
}>();

const emit = defineEmits<{
  activateTab: [tabId: string];
  closeTab: [tabId: string];
  updateTaskListOpen: [open: boolean];
  controlDownloadTask: [
    task: DownloadTask,
    action: "pause" | "resume" | "cancel",
  ];
  openSettings: [];
  minimizeWindow: [];
  toggleMaximizeWindow: [];
  closeWindow: [];
}>();
</script>

<template>
  <header class="topbar">
    <section class="header-brand">
      <div class="brand-mark">OSSH</div>
      <div>
        <h1>OrbitSSH</h1>
        <p>SSH Terminal Client</p>
      </div>
    </section>
    <nav class="tabs" aria-label="终端标签">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        :class="['tab', { active: tab.id === activeTabId }]"
        role="button"
        tabindex="0"
        @click="emit('activateTab', tab.id)">
        <span>{{ tab.title }}</span>
        <small>{{ getStatusText(tab.status) }}</small>
        <button
          type="button"
          class="tab-close"
          aria-label="关闭终端"
          @click.stop="emit('closeTab', tab.id)">
          <img :src="closeIcon" alt="" />
        </button>
      </div>
    </nav>
    <div class="titlebar-drag-zone" aria-hidden="true"></div>
    <div class="window-actions">
      <div class="tasklist" @click.stop>
        <button
          type="button"
          class="tasklist-trigger"
          aria-label="下载任务"
          title="下载任务"
          @click="emit('updateTaskListOpen', !isTaskListOpen)">
          <img :src="taskIcon" alt="" />
          <strong v-if="activeDownloadCount > 0">
            {{ activeDownloadCount }}
          </strong>
        </button>
        <section v-if="isTaskListOpen" class="tasklist-panel">
          <header>
            <span>下载任务</span>
            <small>{{ visibleDownloadTasks.length }} 项</small>
          </header>
          <div v-if="visibleDownloadTasks.length === 0" class="tasklist-empty">
            暂无下载任务
          </div>
          <template v-else>
            <article
              v-for="task in visibleDownloadTasks"
              :key="task.taskId"
              class="tasklist-item">
              <div class="tasklist-item-head">
                <strong>{{ task.name }}</strong>
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
    </div>
  </header>
</template>
