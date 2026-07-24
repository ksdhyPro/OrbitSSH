<script setup lang="ts">
import type { SystemDiskStats } from "../../shared/system-stats";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useTerminalsStore } from "../stores/useTerminalsStore";

interface StatsEntry {
  cpuUsage: number;
  memoryUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  diskFree: number;
  diskTotal: number;
  disks: SystemDiskStats[];
  osName: string;
}

interface DiskDisplayEntry {
  key: string;
  label: string;
  name: string;
  free: number;
  total: number;
}

const props = defineProps<{
  activeTabId: string;
}>();

const terminalsStore = useTerminalsStore();

// 当前激活 Tab 的连接状态
const activeTab = computed(() =>
  terminalsStore.tabs.find(tab => tab.id === props.activeTabId),
);

const isDisconnected = computed(() => {
  if (!activeTab.value) return false;
  return activeTab.value.status === "disconnected" || activeTab.value.status === "error";
});

// 按 tabId 缓存最近一次成功拉取的数据，切换回来时立即显示，避免闪烁。
const statsCache = reactive<Record<string, StatsEntry>>({});

// 当前展示的数值（未拉取到远端数据前展示 "--"）。
const currentStats = computed<StatsEntry | null>(() => {
  const tabId = props.activeTabId;
  if (!tabId) return null;
  if (statsCache[tabId]) return statsCache[tabId];

  return null;
});

const diskDisplayIndex = ref(0);

const diskDisplayEntries = computed<DiskDisplayEntry[]>(() => {
  const s = currentStats.value;
  if (!s || s.diskTotal <= 0) return [];

  return [
    {
      key: "total",
      label: "总量",
      name: "全部磁盘",
      free: s.diskFree,
      total: s.diskTotal,
    },
    ...s.disks.map(disk => ({
      key: `${disk.name}:${disk.mountPoint}`,
      label: disk.mountPoint || disk.name,
      name: disk.name,
      free: disk.free,
      total: disk.total,
    })),
  ];
});

const currentDiskDisplay = computed(() => {
  const entries = diskDisplayEntries.value;
  if (entries.length === 0) return null;
  return entries[diskDisplayIndex.value % entries.length];
});

let cpuMemoryTimer: ReturnType<typeof setInterval> | undefined;
let diskTimer: ReturnType<typeof setInterval> | undefined;
let diskDisplayTimer: ReturnType<typeof setInterval> | undefined;

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

function getUsagePercent(entry: Pick<DiskDisplayEntry, "free" | "total">): number {
  if (entry.total <= 0) return 0;
  return Math.round(((entry.total - entry.free) / entry.total) * 100);
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
        disks: statsCache[tabId]?.disks ?? [],
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
        disks: result.disks ?? [],
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
  if (isWindowHidden() || !props.activeTabId || isDisconnected.value) return;
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

  diskDisplayTimer = setInterval(() => {
    const count = diskDisplayEntries.value.length;
    if (count > 1) {
      diskDisplayIndex.value = (diskDisplayIndex.value + 1) % count;
    }
  }, 3500);
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
  if (diskDisplayTimer !== undefined) {
    window.clearInterval(diskDisplayTimer);
    diskDisplayTimer = undefined;
  }
}

function handleVisibilityChange(): void {
  if (isWindowHidden()) {
    stopPolling();
  } else {
    startPolling();
  }
}

// 连接断开时立即停止轮询，避免继续向远端探测；
// 恢复连接后重新开始拉取系统指标。
watch(isDisconnected, disconnected => {
  if (disconnected) {
    stopPolling();
  } else if (!isWindowHidden() && props.activeTabId) {
    startPolling();
  }
});

// 切换标签时同步重启轮询，目标 Tab 改变。
watch(
  () => props.activeTabId,
  newTabId => {
    diskDisplayIndex.value = 0;
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
    <template v-if="isDisconnected">
      <div class="status-bar-item status-bar-disconnected">
        <span class="status-dot dot-danger"></span>
        <span>连接已断开</span>
      </div>
    </template>
    <template v-else>
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
      <div
        class="status-bar-item status-bar-disk"
        tabindex="0"
        aria-label="磁盘容量详情">
        <span class="status-bar-label">磁盘</span>
        <span class="status-bar-value">
          <template v-if="currentDiskDisplay">
            <span
              :class="[
                'status-dot',
                dotClass(getUsagePercent(currentDiskDisplay)),
              ]"></span>
            <span class="status-bar-disk-label">{{ currentDiskDisplay.label }}</span>
            {{ getUsagePercent(currentDiskDisplay) }}%
            <small>
              {{ formatBytes(currentDiskDisplay.total - currentDiskDisplay.free) }} /
              {{ formatBytes(currentDiskDisplay.total) }}
            </small>
          </template>
          <template v-else>--</template>
        </span>
        <div
          v-if="diskDisplayEntries.length > 0"
          class="status-bar-disk-details"
          role="tooltip">
          <div class="status-bar-disk-details-header">
            <strong>磁盘容量</strong>
            <span>{{ currentStats?.disks.length ?? 0 }} 个挂载点</span>
          </div>
          <div
            v-for="entry in diskDisplayEntries"
            :key="entry.key"
            class="status-bar-disk-detail-row">
            <div class="status-bar-disk-detail-name">
              <strong>{{ entry.label }}</strong>
              <span>{{ entry.name }}</span>
            </div>
            <div class="status-bar-disk-detail-capacity">
              <strong>{{ getUsagePercent(entry) }}%</strong>
              <span>
                {{ formatBytes(entry.total - entry.free) }} /
                {{ formatBytes(entry.total) }}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div class="status-bar-os">
        <template v-if="currentStats?.osName">{{ currentStats.osName }}</template>
      </div>
    </template>
  </div>
</template>
