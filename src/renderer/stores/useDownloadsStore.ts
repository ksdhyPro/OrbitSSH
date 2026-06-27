import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  SftpDownloadProgressEvent,
  SftpRemoteTransferProgressEvent,
  SftpUploadProgressEvent,
} from "../../shared/sftp";
import type { DownloadTask } from "../types/download";
import { useCoreStore } from "./useCoreStore";
import { useSftpStore } from "./useSftpStore";

// 传输任务列表 store：统一管理上传/下载状态、进度事件与暂停/继续/取消控制。
export const useDownloadsStore = defineStore("downloads", () => {
  const core = useCoreStore();
  const downloadTasks = ref<DownloadTask[]>([]);
  const downloadTaskOperationIds = ref<Set<string>>(new Set());
  const isTaskListOpen = ref(false);

  const activeDownloadCount = computed(
    () =>
      downloadTasks.value.filter(task =>
        ["queued", "started", "progress", "paused"].includes(task.status),
      ).length,
  );

  const visibleDownloadTasks = computed(() => downloadTasks.value);

  function isDownloadTaskOperating(taskId: string): boolean {
    return downloadTaskOperationIds.value.has(taskId);
  }

  function upsertDownloadTask(task: DownloadTask): void {
    const existingIndex = downloadTasks.value.findIndex(
      item => item.taskId === task.taskId,
    );

    if (existingIndex >= 0) {
      downloadTasks.value = downloadTasks.value.map((item, index) =>
        index === existingIndex ? { ...item, ...task } : item,
      );
      return;
    }

    downloadTasks.value = [task, ...downloadTasks.value].slice(0, 50);
  }

  function handleSftpDownloadProgress(event: SftpDownloadProgressEvent): void {
    upsertDownloadTask({
      taskId: event.taskId,
      tabId: event.tabId,
      direction: "download",
      name: event.name,
      path: event.path,
      status: event.status,
      transferredBytes: event.transferredBytes,
      totalBytes: event.totalBytes,
      speedBytesPerSecond: event.speedBytesPerSecond,
      filePath: event.filePath,
      error: event.error,
    });
  }

  function handleSftpUploadProgress(event: SftpUploadProgressEvent): void {
    upsertDownloadTask({
      taskId: event.taskId,
      tabId: event.tabId,
      direction: "upload",
      name: event.name,
      path: event.path,
      status: event.status,
      transferredBytes: event.transferredBytes,
      totalBytes: event.totalBytes,
      speedBytesPerSecond: event.speedBytesPerSecond,
      localPaths: event.localPaths,
      remoteDirectoryPath: event.remoteDirectoryPath,
      error: event.error,
    });

    if (event.status === "completed") {
      void useSftpStore().refreshRemoteDirectoryPath(
        event.tabId,
        event.remoteDirectoryPath,
      );
    }
  }

  function handleSftpRemoteTransferProgress(
    event: SftpRemoteTransferProgressEvent,
  ): void {
    upsertDownloadTask({
      taskId: event.taskId,
      tabId: event.targetServerId,
      direction: "server-transfer",
      name: event.name,
      path: event.path,
      status: event.status,
      transferredBytes: event.transferredBytes,
      totalBytes: event.totalBytes,
      speedBytesPerSecond: event.speedBytesPerSecond,
      sourceServerId: event.sourceServerId,
      targetServerId: event.targetServerId,
      transferPhase: event.phase,
      targetDirectoryPath: event.targetDirectoryPath,
      error: event.error,
    });
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
      let isControlled = true;

      if (task.direction === "upload") {
        if (!core.orbitSSHApi?.sftp.controlUpload) {
          throw new Error("当前窗口未加载上传控制能力，请重启应用后重试");
        }

        isControlled = await core.orbitSSHApi.sftp.controlUpload({
          taskId: task.taskId,
          action,
        });
      } else if (task.direction === "server-transfer") {
        if (!core.orbitSSHApi?.sftp.controlRemoteTransfer) {
          throw new Error("当前窗口未加载数据传输控制能力，请重启应用后重试");
        }

        isControlled = await core.orbitSSHApi.sftp.controlRemoteTransfer({
          taskId: task.taskId,
          action,
        });
      } else if (action === "resume") {
        await core.orbitSSHApi?.sftp.download({
          tabId: task.tabId,
          path: task.path,
          name: task.name,
          size: task.totalBytes || undefined,
          taskId: task.taskId,
          localPath: task.filePath,
          transferredBytes: task.transferredBytes,
        });
      } else {
        if (!core.orbitSSHApi?.sftp.controlDownload) {
          throw new Error("当前窗口未加载下载控制能力，请重启应用后重试");
        }

        isControlled = await core.orbitSSHApi.sftp.controlDownload({
          taskId: task.taskId,
          action,
          localPath: task.filePath,
        });
      }

      if (!isControlled) {
        throw new Error("传输任务状态已变化，请稍后重试");
      }

      if (action === "cancel") {
        downloadTasks.value = downloadTasks.value.map(item =>
          item.taskId === task.taskId ? { ...item, status: "canceled" } : item,
        );
      }
    } catch (error) {
      downloadTasks.value = downloadTasks.value.map(item =>
        item.taskId === task.taskId
          ? {
              ...item,
              status: "error",
              error: error instanceof Error ? error.message : "传输任务操作失败",
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
  let removeSftpUploadProgressListener: (() => void) | undefined;
  let removeSftpRemoteTransferProgressListener: (() => void) | undefined;

  function startListeners(): void {
    if (core.orbitSSHApi && !removeSftpDownloadProgressListener) {
      removeSftpDownloadProgressListener =
        core.orbitSSHApi.sftp.onDownloadProgress(handleSftpDownloadProgress);
    }

    if (core.orbitSSHApi && !removeSftpUploadProgressListener) {
      removeSftpUploadProgressListener =
        core.orbitSSHApi.sftp.onUploadProgress(handleSftpUploadProgress);
    }

    if (
      core.orbitSSHApi?.sftp.onRemoteTransferProgress &&
      !removeSftpRemoteTransferProgressListener
    ) {
      removeSftpRemoteTransferProgressListener =
        core.orbitSSHApi.sftp.onRemoteTransferProgress(
          handleSftpRemoteTransferProgress,
        );
    }
  }

  function stopListeners(): void {
    removeSftpDownloadProgressListener?.();
    removeSftpDownloadProgressListener = undefined;
    removeSftpUploadProgressListener?.();
    removeSftpUploadProgressListener = undefined;
    removeSftpRemoteTransferProgressListener?.();
    removeSftpRemoteTransferProgressListener = undefined;
  }

  return {
    downloadTasks,
    downloadTaskOperationIds,
    isTaskListOpen,
    activeDownloadCount,
    visibleDownloadTasks,
    isDownloadTaskOperating,
    handleSftpDownloadProgress,
    handleSftpUploadProgress,
    handleSftpRemoteTransferProgress,
    controlDownloadTask,
    removeDownloadTask,
    startListeners,
    stopListeners,
  };
});
