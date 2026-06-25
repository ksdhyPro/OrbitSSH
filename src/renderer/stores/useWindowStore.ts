import { defineStore } from "pinia";
import { ref } from "vue";
import { useCoreStore } from "./useCoreStore";

// 窗口控制 store。窗口尺寸变化（含最大化/还原）会触发 window resize 事件，
// 由 App.vue 的 resize 监听统一调度终端 fit，因此此处不再直接调用终端域逻辑。
export const useWindowStore = defineStore("window", () => {
  const core = useCoreStore();
  const isWindowMaximized = ref(false);

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

  return {
    isWindowMaximized,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    initMaximized,
  };
});
