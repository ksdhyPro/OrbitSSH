<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";

interface StatsEntry {
  cpuUsage: number;
  memoryUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  diskFree: number;
  diskTotal: number;
  osName: string;
}

const props = defineProps<{
  activeTabId: string;
}>();

// 按 tabId 缓存最近一次成功拉取的数据，切换回来时立即显示，避免闪烁。
const statsCache = reactive<Record<string, StatsEntry>>({});

// 当前展示的数值（未拉取到远端数据前展示 "--"）。
const currentStats = computed<StatsEntry | null>(() => {
  const tabId = props.activeTabId;
  if (!tabId) return null;
  if (statsCache[tabId]) return statsCache[tabId];

  return null;
});

const diskUsage = computed(() => {
  const s = currentStats.value;
  if (!s || s.diskTotal <= 0) return 0;
  const used = s.diskTotal - s.diskFree;
  return Math.round((used / s.diskTotal) * 100);
});

let cpuMemoryTimer: ReturnType<typeof setInterval> | undefined;
let diskTimer: ReturnType<typeof setInterval> | undefined;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "--";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)}T`;
  if (gb >= 1) return `${gb.toFixed(1)}G`;
  return `${(bytes / (1024 * 1024)).toFixed(0)}M`;
}

function dotClass(pct: number): string {
  if (pct <= 80) return "dot-safe";
  if (pct <= 95) return "dot-warn";
  return "dot-danger";
}

async function fetchCpuMemory(): Promise<void> {
  const tabId = props.activeTabId;
  if (!tabId) return;

  try {
    const result = await window.orbitSSH?.system.getStats(tabId);
    if (result && props.activeTabId === tabId) {
      statsCache[tabId] = {
        cpuUsage: result.cpuUsage,
        memoryUsage: result.memoryUsage,
        memoryUsed: result.memoryUsed,
        memoryTotal: result.memoryTotal,
        diskFree: statsCache[tabId]?.diskFree ?? 0,
        diskTotal: statsCache[tabId]?.diskTotal ?? 0,
        osName: result.osName || statsCache[tabId]?.osName || "",
      };
    }
  } catch {
    // 远端不可用时静默忽略
  }
}

async function fetchDisk(): Promise<void> {
  const tabId = props.activeTabId;
  if (!tabId) return;

  try {
    const result = await window.orbitSSH?.system.getStats(tabId);
    if (result && props.activeTabId === tabId) {
      statsCache[tabId] = {
        cpuUsage: statsCache[tabId]?.cpuUsage ?? result.cpuUsage,
        memoryUsage: statsCache[tabId]?.memoryUsage ?? result.memoryUsage,
        memoryUsed: statsCache[tabId]?.memoryUsed ?? result.memoryUsed,
        memoryTotal: statsCache[tabId]?.memoryTotal ?? result.memoryTotal,
        diskFree: result.diskFree,
        diskTotal: result.diskTotal,
        osName: result.osName || statsCache[tabId]?.osName || "",
      };
    }
  } catch {
    // 远端不可用时静默忽略
  }
}

function isWindowHidden(): boolean {
  return document.visibilityState === "hidden" || document.hidden;
}

function startPolling(): void {
  if (isWindowHidden() || !props.activeTabId) return;
  stopPolling();

  // 立即拉取一次
  void fetchCpuMemory();
  void fetchDisk();

  cpuMemoryTimer = setInterval(() => {
    if (isWindowHidden() || !props.activeTabId) {
      stopPolling();
      return;
    }
    void fetchCpuMemory();
  }, 1000);

  diskTimer = setInterval(() => {
    if (isWindowHidden() || !props.activeTabId) {
      stopPolling();
      return;
    }
    void fetchDisk();
  }, 5000);
}

function stopPolling(): void {
  if (cpuMemoryTimer !== undefined) {
    window.clearInterval(cpuMemoryTimer);
    cpuMemoryTimer = undefined;
  }
  if (diskTimer !== undefined) {
    window.clearInterval(diskTimer);
    diskTimer = undefined;
  }
}

function handleVisibilityChange(): void {
  if (isWindowHidden()) {
    stopPolling();
  } else {
    startPolling();
  }
}

// 切换标签时同步重启轮询，目标 Tab 改变。
watch(
  () => props.activeTabId,
  newTabId => {
    if (newTabId && !isWindowHidden()) {
      startPolling();
    } else {
      stopPolling();
    }
  },
);

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (props.activeTabId && !isWindowHidden()) {
    startPolling();
  }
});

onUnmounted(() => {
  stopPolling();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<template>
  <div v-if="activeTabId" class="status-bar" aria-label="系统状态栏">
    <div class="status-bar-item">
      <span class="status-bar-label">CPU</span>
      <span class="status-bar-value">
        <template v-if="currentStats">
          <span :class="['status-dot', dotClass(currentStats.cpuUsage)]"></span>
          {{ currentStats.cpuUsage }}%
        </template>
        <template v-else>--</template>
      </span>
    </div>
    <div class="status-bar-item">
      <span class="status-bar-label">内存</span>
      <span class="status-bar-value">
        <template v-if="currentStats">
          <span
            :class="['status-dot', dotClass(currentStats.memoryUsage)]"></span>
          {{ currentStats.memoryUsage }}%
          <small>
            {{ formatBytes(currentStats.memoryUsed) }} /
            {{ formatBytes(currentStats.memoryTotal) }}
          </small>
        </template>
        <template v-else>--</template>
      </span>
    </div>
    <div class="status-bar-item">
      <span class="status-bar-label">磁盘</span>
      <span class="status-bar-value">
        <template v-if="currentStats && currentStats.diskTotal > 0">
          <span :class="['status-dot', dotClass(diskUsage)]"></span>
          {{ diskUsage }}%
          <small>
            {{ formatBytes(currentStats.diskTotal - currentStats.diskFree) }} /
            {{ formatBytes(currentStats.diskTotal) }}
          </small>
        </template>
        <template v-else>--</template>
      </span>
    </div>
    <div class="status-bar-os">
      <template v-if="currentStats?.osName">{{ currentStats.osName }}</template>
    </div>
  </div>
</template>
