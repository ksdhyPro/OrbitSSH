import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { SftpDownloadProgressEvent } from "../../shared/sftp";
import type { DownloadTask } from "../types/download";
import { useCoreStore } from "./useCoreStore";

// 下载任务列表 store：管理任务状态、进度事件与暂停/继续/取消控制。
// 发起下载（downloadRemoteFileNode）属 SFTP 域，由 useSftpStore 调用 sftp.download。
export const useDownloadsStore = defineStore("downloads", () => {
  const core = useCoreStore();
  const downloadTasks = ref<DownloadTask[]>([]);
  const downloadTaskOperationIds = ref<Set<string>>(new Set());
  const isTaskListOpen = ref(false);

  const activeDownloadCount = computed(
    () =>
      downloadTasks.value.filter(task =>
        ["started", "progress", "paused"].includes(task.status),
      ).length,
  );

  const visibleDownloadTasks = computed(() =>
    downloadTasks.value.filter(task => task.status !== "completed"),
  );

  function isDownloadTaskOperating(taskId: string): boolean {
    return downloadTaskOperationIds.value.has(taskId);
  }

  function closeTaskList(): void {
    isTaskListOpen.value = false;
  }

  function handleSftpDownloadProgress(event: SftpDownloadProgressEvent): void {
    if (event.status === "completed") {
      downloadTasks.value = downloadTasks.value.filter(
        item => item.taskId !== event.taskId,
      );
      return;
    }

    const task: DownloadTask = {
      taskId: event.taskId,
      tabId: event.tabId,
      name: event.name,
      path: event.path,
      status: event.status,
      transferredBytes: event.transferredBytes,
      totalBytes: event.totalBytes,
      speedBytesPerSecond: event.speedBytesPerSecond,
      filePath: event.filePath,
      error: event.error,
    };
    const existingIndex = downloadTasks.value.findIndex(
      item => item.taskId === event.taskId,
    );

    if (existingIndex >= 0) {
      downloadTasks.value = downloadTasks.value.map((item, index) =>
        index === existingIndex ? { ...item, ...task } : item,
      );
      return;
    }

    downloadTasks.value = [task, ...downloadTasks.value].slice(0, 20);
  }

  function removeDownloadTask(taskId: string): void {
    downloadTasks.value = downloadTasks.value.filter(
      task => task.taskId !== taskId,
    );
  }

  async function controlDownloadTask(
    task: DownloadTask,
    action: "pause" | "resume" | "cancel",
  ): Promise<void> {
    if (isDownloadTaskOperating(task.taskId)) {
      return;
    }

    downloadTaskOperationIds.value = new Set([
      ...downloadTaskOperationIds.value,
      task.taskId,
    ]);

    try {
      if (action === "resume") {
        await core.orbitSSHApi?.sftp.download({
          tabId: task.tabId,
          path: task.path,
          name: task.name,
          size: task.totalBytes || undefined,
          taskId: task.taskId,
          localPath: task.filePath,
          transferredBytes: task.transferredBytes,
        });
        return;
      }

      await core.orbitSSHApi?.sftp.controlDownload({
        taskId: task.taskId,
        action,
        localPath: task.filePath,
      });

      if (action === "cancel") {
        downloadTasks.value = downloadTasks.value.map(item =>
          item.taskId === task.taskId ? { ...item, status: "canceled" } : item,
        );
        removeDownloadTask(task.taskId);
      }
    } catch (error) {
      downloadTasks.value = downloadTasks.value.map(item =>
        item.taskId === task.taskId
          ? {
              ...item,
              status: "error",
              error: error instanceof Error ? error.message : "下载任务操作失败",
            }
          : item,
      );
    } finally {
      const nextOperationIds = new Set(downloadTaskOperationIds.value);
      nextOperationIds.delete(task.taskId);
      downloadTaskOperationIds.value = nextOperationIds;
    }
  }

  let removeSftpDownloadProgressListener: (() => void) | undefined;

  function startListeners(): void {
    if (core.orbitSSHApi && !removeSftpDownloadProgressListener) {
      removeSftpDownloadProgressListener =
        core.orbitSSHApi.sftp.onDownloadProgress(
          handleSftpDownloadProgress,
        );
    }
  }

  function stopListeners(): void {
    removeSftpDownloadProgressListener?.();
    removeSftpDownloadProgressListener = undefined;
  }

  return {
    downloadTasks,
    downloadTaskOperationIds,
    isTaskListOpen,
    activeDownloadCount,
    visibleDownloadTasks,
    isDownloadTaskOperating,
    closeTaskList,
    handleSftpDownloadProgress,
    controlDownloadTask,
    removeDownloadTask,
    startListeners,
    stopListeners,
  };
});
