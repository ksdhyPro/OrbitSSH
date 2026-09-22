<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  SftpManagedTaskBatch,
  SftpManagedTaskControlInput,
  SftpManagedTaskNode,
  SftpManagedTaskStatus,
} from "../../shared/sftp";
import chevronDownIcon from "../assets/icons/chevron-down.svg";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import continueIcon from "../assets/icons/continue.svg";
import pauseIcon from "../assets/icons/pause.svg";
import refreshIcon from "../assets/icons/refresh.svg";
import trashIcon from "../assets/icons/trash.svg";
import { formatFileSize, formatTransferSpeed } from "../utils/format";
import AppDialog from "./AppDialog.vue";

const props = defineProps<{
  open: boolean;
  batches: SftpManagedTaskBatch[];
  nodes: SftpManagedTaskNode[];
  isOperating: (taskId: string, nodeId?: string) => boolean;
}>();

const emit = defineEmits<{
  close: [];
  control: [input: SftpManagedTaskControlInput];
}>();

interface VisibleRow {
  node: SftpManagedTaskNode;
  depth: number;
}

const expandedIds = ref(new Set<string>());
const visibleLimits = ref<Record<string, number>>({});
const selectedIds = ref(new Set<string>());
const lastSelectedId = ref("");

const nodesByTask = computed(() => {
  const result = new Map<string, SftpManagedTaskNode[]>();
  for (const node of props.nodes) {
    const items = result.get(node.taskId) ?? [];
    items.push(node);
    result.set(node.taskId, items);
  }
  return result;
});

function childrenOf(taskId: string, parentId?: string): SftpManagedTaskNode[] {
  return (nodesByTask.value.get(taskId) ?? []).filter(
    (node) => node.parentId === parentId,
  );
}

function appendRows(
  taskId: string,
  parentId: string | undefined,
  depth: number,
  rows: VisibleRow[],
): void {
  const children = childrenOf(taskId, parentId);
  const limitKey = parentId ?? `batch:${taskId}`;
  const limit = visibleLimits.value[limitKey] ?? 300;
  for (const node of children.slice(0, limit)) {
    rows.push({ node, depth });
    if (node.type === "directory" && expandedIds.value.has(node.id)) {
      appendRows(taskId, node.id, depth + 1, rows);
    }
  }
}

function visibleRows(batch: SftpManagedTaskBatch): VisibleRow[] {
  const rows: VisibleRow[] = [];
  // 批次不再作为树节点展示，根文件和目录直接从第一层开始排列。
  appendRows(batch.taskId, undefined, 0, rows);
  return rows;
}

function hasMore(taskId: string, parentId?: string): boolean {
  const key = parentId ?? `batch:${taskId}`;
  return childrenOf(taskId, parentId).length > (visibleLimits.value[key] ?? 300);
}

function showMore(taskId: string, parentId?: string): void {
  const key = parentId ?? `batch:${taskId}`;
  visibleLimits.value = {
    ...visibleLimits.value,
    [key]: (visibleLimits.value[key] ?? 300) + 300,
  };
}

function toggleExpanded(id: string): void {
  const next = new Set(expandedIds.value);
  next.has(id) ? next.delete(id) : next.add(id);
  expandedIds.value = next;
}

function statusText(status: SftpManagedTaskStatus): string {
  if (status === "transferring") return "传输中";
  if (status === "paused") return "已暂停";
  if (status === "failed") return "失败";
  return "等待中";
}

function progressPercent(item: {
  transferredBytes: number;
  totalBytes: number;
}): number {
  if (item.totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, (item.transferredBytes / item.totalBytes) * 100));
}

function selectRow(event: MouseEvent, batch: SftpManagedTaskBatch, nodeId: string): void {
  const rowIds = visibleRows(batch).map((row) => row.node.id);
  const next = new Set(event.ctrlKey || event.metaKey ? selectedIds.value : []);

  if (event.shiftKey && lastSelectedId.value) {
    const start = rowIds.indexOf(lastSelectedId.value);
    const end = rowIds.indexOf(nodeId);
    if (start >= 0 && end >= 0) {
      for (const id of rowIds.slice(Math.min(start, end), Math.max(start, end) + 1)) {
        next.add(id);
      }
    }
  } else if ((event.ctrlKey || event.metaKey) && next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }

  selectedIds.value = next;
  lastSelectedId.value = nodeId;
}

function sendAction(
  batch: SftpManagedTaskBatch,
  action: SftpManagedTaskControlInput["action"],
  nodeId?: string,
): void {
  const selectedInBatch = props.nodes
    .filter((node) => node.taskId === batch.taskId && selectedIds.value.has(node.id))
    .map((node) => node.id);
  const nodeIds = nodeId && selectedIds.value.has(nodeId) ? selectedInBatch : nodeId ? [nodeId] : undefined;
  emit("control", { taskId: batch.taskId, nodeIds, action });
}

</script>

<template>
  <AppDialog v-if="open" title="传输任务" width="transfer" @close="emit('close')">
    <div class="transfer-task-list">
      <div v-if="batches.length === 0" class="transfer-task-empty">暂无传输任务</div>
      <section v-for="batch in batches" :key="batch.taskId" class="transfer-task-batch">
        <div class="transfer-task-children">
          <div
            v-for="row in visibleRows(batch)"
            :key="row.node.id"
            :class="['transfer-task-row', { selected: selectedIds.has(row.node.id) }]"
            :style="{ '--tree-depth': row.depth }"
            :title="row.node.relativePath"
            @click="selectRow($event, batch, row.node.id)"
          >
            <button v-if="row.node.type === 'directory' && row.node.childCount" class="transfer-tree-toggle" type="button" @click.stop="toggleExpanded(row.node.id)">
              <img :src="expandedIds.has(row.node.id) ? chevronDownIcon : chevronRightIcon" alt="" />
            </button>
            <span v-else class="transfer-tree-spacer"></span>
            <span class="transfer-task-name">
              {{ row.node.name }}
              <button
                v-if="row.node.type === 'directory' && expandedIds.has(row.node.id) && hasMore(batch.taskId, row.node.id)"
                class="transfer-inline-more"
                type="button"
                @click.stop="showMore(batch.taskId, row.node.id)"
              >再显示 300 项</button>
            </span>
            <span>{{ formatFileSize(row.node.totalBytes) }}</span>
            <span class="transfer-inline-progress" :title="`${Math.round(progressPercent(row.node))}%`">
              <span><i :style="{ width: `${progressPercent(row.node)}%` }"></i></span>
              <small>{{ Math.round(progressPercent(row.node)) }}%</small>
            </span>
            <span>{{ formatTransferSpeed(row.node.speedBytesPerSecond) }}</span>
            <span :class="{ 'is-failed': row.node.status === 'failed' }" :title="row.node.error">{{ statusText(row.node.status) }}</span>
            <div class="transfer-task-actions">
              <button v-if="row.node.status === 'paused'" type="button" title="继续" :disabled="isOperating(batch.taskId, row.node.id)" @click.stop="sendAction(batch, 'resume', row.node.id)"><img :src="continueIcon" alt="继续" /></button>
              <button v-else-if="row.node.status !== 'failed'" type="button" title="暂停" :disabled="isOperating(batch.taskId, row.node.id)" @click.stop="sendAction(batch, 'pause', row.node.id)"><img :src="pauseIcon" alt="暂停" /></button>
              <button v-if="row.node.status === 'failed'" type="button" title="重试" :disabled="isOperating(batch.taskId, row.node.id)" @click.stop="sendAction(batch, 'retry', row.node.id)"><img :src="refreshIcon" alt="重试" /></button>
              <button class="danger" type="button" title="删除" :disabled="isOperating(batch.taskId, row.node.id)" @click.stop="sendAction(batch, 'delete', row.node.id)"><img :src="trashIcon" alt="删除" /></button>
            </div>
          </div>
          <button v-if="hasMore(batch.taskId)" class="transfer-show-more" type="button" @click="showMore(batch.taskId)">再显示 300 项</button>
        </div>
      </section>
    </div>
  </AppDialog>
</template>
