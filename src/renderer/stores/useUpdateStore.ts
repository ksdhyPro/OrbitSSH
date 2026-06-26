import { defineStore } from "pinia";
import { ref } from "vue";
import type { UpdateStatus, UpdateStatusInfo } from "../../shared/settings";
import { useCoreStore } from "./useCoreStore";

export const useUpdateStore = defineStore("update", () => {
  const core = useCoreStore();

  const status = ref<UpdateStatus>("idle");
  const currentVersion = ref("");
  const newVersion = ref<string | undefined>();
  const releaseDate = ref<string | undefined>();
  const releaseNotes = ref<string | undefined>();
  const downloadProgress = ref(0);
  const error = ref<string | undefined>();

  let unsubscribe: (() => void) | undefined;

  function applyStatusInfo(info: UpdateStatusInfo): void {
    status.value = info.status;
    currentVersion.value = info.currentVersion;
    newVersion.value = info.newVersion;
    releaseDate.value = info.releaseDate;
    releaseNotes.value = info.releaseNotes;
    downloadProgress.value = info.downloadProgress ?? 0;
    error.value = info.error;
  }

  async function init(): Promise<void> {
    // 获取初始状态
    try {
      const info = await core.orbitSSHApi?.update.getStatus();
      if (info) {
        applyStatusInfo(info);
      }
    } catch (err) {
      core.writeRendererLog(
        "获取更新状态失败",
        { error: err instanceof Error ? err.message : String(err) },
        "warn",
      );
    }

    // 注册状态变化监听
    unsubscribe = core.orbitSSHApi?.update.onStatusChanged((info) => {
      applyStatusInfo(info);
    });
  }

  function destroy(): void {
    unsubscribe?.();
    unsubscribe = undefined;
  }

  async function checkForUpdates(): Promise<void> {
    try {
      await core.orbitSSHApi?.update.check();
    } catch (err) {
      core.writeRendererLog(
        "检查更新失败",
        { error: err instanceof Error ? err.message : String(err) },
        "error",
      );
    }
  }

  async function downloadUpdate(): Promise<void> {
    try {
      await core.orbitSSHApi?.update.download();
    } catch (err) {
      core.writeRendererLog(
        "下载更新失败",
        { error: err instanceof Error ? err.message : String(err) },
        "error",
      );
    }
  }

  async function installUpdate(): Promise<void> {
    try {
      await core.orbitSSHApi?.update.install();
    } catch (err) {
      core.writeRendererLog(
        "安装更新失败",
        { error: err instanceof Error ? err.message : String(err) },
        "error",
      );
    }
  }

  return {
    status,
    currentVersion,
    newVersion,
    releaseDate,
    releaseNotes,
    downloadProgress,
    error,
    init,
    destroy,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
});
