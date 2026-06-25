import { defineStore } from "pinia";
import { computed } from "vue";

// 横切基础 store：集中暴露 preload API 代理与渲染进程日志，
// 其余 store 通过 useCoreStore() 复用，避免各处重复 computed(() => window.orbitSSH)。
export const useCoreStore = defineStore("core", () => {
  const orbitSSHApi = computed(() => window.orbitSSH);

  function writeRendererLog(
    message: string,
    data?: Record<string, unknown>,
    level: "debug" | "info" | "warn" | "error" = "info",
  ): void {
    const consoleMethod =
      level === "error" ? "error" : level === "warn" ? "warn" : "log";
    console[consoleMethod](`[OrbitSSH renderer] ${message}`, data ?? {});
    void orbitSSHApi.value?.logger.write({
      scope: "renderer",
      level,
      message,
      data,
    });
  }

  return { orbitSSHApi, writeRendererLog };
});
