import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  SftpManagedTaskBatch,
  SftpManagedTaskControlInput,
  SftpManagedTaskEvent,
  SftpManagedTaskNode,
} from "../../shared/sftp";
import { useCoreStore } from "./useCoreStore";

// 传输任务中心只保存主进程快照，调度、清理与状态判定统一由主进程负责。
export const useDownloadsStore = defineStore("downloads", () => {
  const core = useCoreStore();
  const transferBatches = ref<SftpManagedTaskBatch[]>([]);
  const transferNodes = ref<SftpManagedTaskNode[]>([]);
  const isTaskListOpen = ref(false);
  const operatingKeys = ref<Set<string>>(new Set());

  const hasTransferTasks = computed(() => transferBatches.value.length > 0);
  // 兼容标题栏原有属性；界面只把它当作是否显示红点，不展示数字。
  const activeDownloadCount = computed(() => (hasTransferTasks.value ? 1 : 0));
  const visibleDownloadTasks = computed(() => transferBatches.value);

  function applyEvent(event: SftpManagedTaskEvent): void {
    if (event.type === "reset") {
      transferBatches.value = event.snapshot.batches;
      transferNodes.value = event.snapshot.nodes;
      return;
    }

    if (event.type === "batch-upsert") {
      const index = transferBatches.value.findIndex(
        (batch) => batch.taskId === event.batch.taskId,
      );
      // 仅新批次首次提交时打开任务中心；后续进度刷新不改变用户的开关状态。
      if (index < 0) {
        isTaskListOpen.value = true;
      }
      transferBatches.value =
        index < 0
          ? [...transferBatches.value, event.batch]
          : transferBatches.value.map((batch, itemIndex) =>
              itemIndex === index ? event.batch : batch,
            );
      return;
    }

    if (event.type === "batch-remove") {
      transferBatches.value = transferBatches.value.filter(
        (batch) => batch.taskId !== event.taskId,
      );
      transferNodes.value = transferNodes.value.filter(
        (node) => node.taskId !== event.taskId,
      );
      return;
    }

    if (event.type === "node-upsert") {
      const index = transferNodes.value.findIndex(
        (node) => node.id === event.node.id,
      );
      transferNodes.value =
        index < 0
          ? [...transferNodes.value, event.node]
          : transferNodes.value.map((node, itemIndex) =>
              itemIndex === index ? event.node : node,
            );
      return;
    }

    transferNodes.value = transferNodes.value.filter(
      (node) => node.id !== event.nodeId,
    );
  }

  function operationKey(input: SftpManagedTaskControlInput): string {
    return `${input.taskId}:${input.nodeIds?.join(",") ?? "root"}:${input.action}`;
  }

  function isManagedTaskOperating(
    taskId: string,
    nodeId?: string,
  ): boolean {
    const prefix = `${taskId}:${nodeId ?? "root"}:`;
    return [...operatingKeys.value].some((key) => key.startsWith(prefix));
  }

  async function controlManagedTask(
    input: SftpManagedTaskControlInput,
  ): Promise<boolean> {
    const key = operationKey(input);
    if (operatingKeys.value.has(key)) {
      return false;
    }

    operatingKeys.value = new Set([...operatingKeys.value, key]);
    try {
      if (!core.orbitSSHApi?.sftp.controlManagedTask) {
        throw new Error("当前窗口未加载任务控制能力，请重启应用后重试");
      }
      return await core.orbitSSHApi.sftp.controlManagedTask(input);
    } finally {
      const nextKeys = new Set(operatingKeys.value);
      nextKeys.delete(key);
      operatingKeys.value = nextKeys;
    }
  }

  // 兼容旧组件调用，后续任务列表统一使用节点级控制。
  async function controlDownloadTask(
    task: { taskId: string },
    action: "pause" | "resume" | "cancel",
  ): Promise<void> {
    await controlManagedTask({
      taskId: task.taskId,
      action: action === "cancel" ? "delete" : action,
    });
  }

  function isDownloadTaskOperating(taskId: string): boolean {
    return isManagedTaskOperating(taskId);
  }

  function removeDownloadTask(taskId: string): void {
    void controlManagedTask({ taskId, action: "delete" });
  }

  let removeManagedTaskListener: (() => void) | undefined;

  async function startListeners(): Promise<void> {
    if (!core.orbitSSHApi?.sftp.onManagedTaskEvent) {
      return;
    }

    if (!removeManagedTaskListener) {
      removeManagedTaskListener =
        core.orbitSSHApi.sftp.onManagedTaskEvent(applyEvent);
    }

    const snapshot = await core.orbitSSHApi.sftp.listManagedTasks();
    applyEvent({ type: "reset", snapshot });
  }

  function stopListeners(): void {
    removeManagedTaskListener?.();
    removeManagedTaskListener = undefined;
  }

  return {
    transferBatches,
    transferNodes,
    isTaskListOpen,
    operatingKeys,
    hasTransferTasks,
    activeDownloadCount,
    visibleDownloadTasks,
    isManagedTaskOperating,
    isDownloadTaskOperating,
    controlManagedTask,
    controlDownloadTask,
    removeDownloadTask,
    startListeners,
    stopListeners,
  };
});
