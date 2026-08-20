<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useTerminalsStore } from "../stores/useTerminalsStore";

interface StatsEntry {
  cpuUsage: number;
  memoryUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  diskFree: number;
  diskTotal: number;
  osName: string;
}

interface StatsHistory {
  cpu: number[];
  memory: number[];
  disk: number[];
}

type StatsHistoryKey = keyof StatsHistory;

const MAX_SPARKLINE_POINTS = 24;
const SPARKLINE_WIDTH = 38;
const SPARKLINE_HEIGHT = 12;
const SPARKLINE_PADDING = 1;
// 折线表达近期趋势而非绝对刻度；最小显示区间避免稳定数据被夸大成剧烈波动。
const MIN_SPARKLINE_RANGE = 12;

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

// 每个终端独立保留最近采样，切换标签时避免不同服务器的折线互相串联。
const statsHistory = reactive<Record<string, StatsHistory>>({});

// 当前展示的数值（未拉取到远端数据前展示 "--"）。
const currentStats = computed<StatsEntry | null>(() => {
  const tabId = props.activeTabId;
  if (!tabId) return null;
  if (statsCache[tabId]) return statsCache[tabId];

  return null;
});

const currentHistory = computed<StatsHistory | null>(() => {
  const tabId = props.activeTabId;
  return tabId ? statsHistory[tabId] ?? null : null;
});

function calculateDiskUsage(diskFree: number, diskTotal: number): number {
  if (diskTotal <= 0) return 0;
  return Math.round(((diskTotal - diskFree) / diskTotal) * 100);
}

const diskUsage = computed(() => {
  const s = currentStats.value;
  return s ? calculateDiskUsage(s.diskFree, s.diskTotal) : 0;
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

function sparklineToneClass(pct: number): string {
  if (pct <= 80) return "sparkline-safe";
  if (pct <= 95) return "sparkline-warn";
  return "sparkline-danger";
}

function appendHistory(
  tabId: string,
  key: StatsHistoryKey,
  value: number,
): void {
  const history =
    statsHistory[tabId] ??
    (statsHistory[tabId] = { cpu: [], memory: [], disk: [] });
  const values = history[key];

  values.push(Math.min(100, Math.max(0, value)));
  if (values.length > MAX_SPARKLINE_POINTS) {
    values.splice(0, values.length - MAX_SPARKLINE_POINTS);
  }
}

function sparklinePoints(values: number[] | undefined): string {
  if (!values?.length) return "";

  const drawableWidth = SPARKLINE_WIDTH - SPARKLINE_PADDING * 2;
  const drawableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const midpoint = (minimum + maximum) / 2;
  const visibleRange = Math.max(maximum - minimum, MIN_SPARKLINE_RANGE);
  const upperBound = midpoint + visibleRange / 2;
  const toY = (value: number): number =>
    SPARKLINE_PADDING +
    ((upperBound - value) / visibleRange) * drawableHeight;

  // 首次或稳定采样显示在中线，避免高占用率让折线长期贴住顶部。
  if (values.length === 1) {
    const y = toY(values[0]);
    return `${SPARKLINE_PADDING},${y.toFixed(1)} ${SPARKLINE_WIDTH - SPARKLINE_PADDING},${y.toFixed(1)}`;
  }

  const intervalCount = Math.max(values.length - 1, 1);

  return values
    .map((value, index) => {
      const x = SPARKLINE_PADDING + (index / intervalCount) * drawableWidth;
      const y = toY(value);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

async function fetchCpuMemory(): Promise<void> {
  const tabId = props.activeTabId;
  if (!tabId) return;

  try {
    const result = await window.orbitSSH?.system.getStats(tabId);
    if (result && props.activeTabId === tabId) {
      appendHistory(tabId, "cpu", result.cpuUsage);
      appendHistory(tabId, "memory", result.memoryUsage);
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
      appendHistory(
        tabId,
        "disk",
        calculateDiskUsage(result.diskFree, result.diskTotal),
      );
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
            <!-- 暂时隐藏迷你折线，保留实现便于后续直接恢复。 -->
            <!--
            <svg
              :class="[
                'status-sparkline',
                sparklineToneClass(currentStats.cpuUsage),
              ]"
              viewBox="0 0 38 12"
              preserveAspectRatio="none"
              aria-hidden="true">
              <polyline :points="sparklinePoints(currentHistory?.cpu)" />
            </svg>
            -->
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
            <!-- 暂时隐藏迷你折线，保留实现便于后续直接恢复。 -->
            <!--
            <svg
              :class="[
                'status-sparkline',
                sparklineToneClass(currentStats.memoryUsage),
              ]"
              viewBox="0 0 38 12"
              preserveAspectRatio="none"
              aria-hidden="true">
              <polyline :points="sparklinePoints(currentHistory?.memory)" />
            </svg>
            -->
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
            <!-- 暂时隐藏迷你折线，保留实现便于后续直接恢复。 -->
            <!--
            <svg
              :class="['status-sparkline', sparklineToneClass(diskUsage)]"
              viewBox="0 0 38 12"
              preserveAspectRatio="none"
              aria-hidden="true">
              <polyline :points="sparklinePoints(currentHistory?.disk)" />
            </svg>
            -->
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
    </template>
  </div>
</template>
