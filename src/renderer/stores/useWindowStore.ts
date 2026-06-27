import { defineStore } from "pinia";
import { ref } from "vue";
import { useCoreStore } from "./useCoreStore";

// 窗口控制 store。窗口尺寸变化（含最大化/还原）会触发 window resize 事件，
// 由 App.vue 的 resize 监听统一调度终端 fit，因此此处不再直接调用终端域逻辑。
export const useWindowStore = defineStore("window", () => {
  const core = useCoreStore();
  const isWindowMaximized = ref(false);
  const isWindowFullScreen = ref(false);
  let stopFullScreenListener: (() => void) | null = null;

  async function minimizeWindow(): Promise<void> {
    await core.orbitSSHApi?.windowControls.minimize();
  }

  async function toggleMaximizeWindow(): Promise<void> {
    const maximized =
      await core.orbitSSHApi?.windowControls.toggleMaximize();
    isWindowMaximized.value = Boolean(maximized);
  }

  async function closeWindow(): Promise<void> {
    await core.orbitSSHApi?.windowControls.close();
  }

  async function initMaximized(): Promise<void> {
    if (core.orbitSSHApi) {
      isWindowMaximized.value =
        await core.orbitSSHApi.windowControls.isMaximized();
    }
  }

  async function initFullScreen(): Promise<void> {
    if (core.orbitSSHApi) {
      isWindowFullScreen.value =
        await core.orbitSSHApi.windowControls.isFullScreen();
    }
  }

  function startFullScreenListener(): void {
    stopFullScreenListener?.();
    stopFullScreenListener =
      core.orbitSSHApi?.windowControls.onFullScreenChanged(fullScreen => {
        isWindowFullScreen.value = fullScreen;
      }) ?? null;
  }

  function stopFullScreenListenerWatch(): void {
    stopFullScreenListener?.();
    stopFullScreenListener = null;
  }

  return {
    isWindowMaximized,
    isWindowFullScreen,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    initMaximized,
    initFullScreen,
    startFullScreenListener,
    stopFullScreenListenerWatch,
  };
});
