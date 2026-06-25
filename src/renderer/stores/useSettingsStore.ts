import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { defaultAppSettings, type AppSettings } from "../../shared/settings";
import { useCoreStore } from "./useCoreStore";

export const selectionBackgroundOptions = [
  "#244763",
  "#365A46",
  "#5B4B2A",
  "#543A5F",
  "#5A2D35",
];

// 设置域 store：只负责 appSettings 状态与持久化。
// 终端/文件编辑器对设置变更的响应（applyTerminalSettings、CodeMirror 主题 reconfigure）
// 由 App.vue 通过 watch(appSettings.terminal) 协调，避免本 store 反向依赖终端/编辑器 store。
export const useSettingsStore = defineStore("settings", () => {
  const core = useCoreStore();
  const appSettings = reactive<AppSettings>(
    structuredClone(defaultAppSettings),
  );
  const isSettingsDialogOpen = ref(false);
  const isSelectionBackgroundDropdownOpen = ref(false);
  const activeSettingsSection = ref<"general" | "shortcuts">("general");

  function toPlainAppSettings(): AppSettings {
    return {
      terminal: {
        fontSize: appSettings.terminal.fontSize,
        lineHeight: appSettings.terminal.lineHeight,
        selectionBackground: appSettings.terminal.selectionBackground,
      },
    };
  }

  async function saveAppSettings(): Promise<void> {
    try {
      const savedSettings = await core.orbitSSHApi?.settings.save(
        toPlainAppSettings(),
      );

      if (savedSettings) {
        Object.assign(appSettings.terminal, savedSettings.terminal);
      }
    } catch (error) {
      core.writeRendererLog(
        "保存设置失败",
        { error: error instanceof Error ? error.message : String(error) },
        "error",
      );
    }
  }

  async function updateTerminalSetting<K extends keyof AppSettings["terminal"]>(
    key: K,
    value: AppSettings["terminal"][K],
  ): Promise<void> {
    appSettings.terminal[key] = value;
    await saveAppSettings();
  }

  async function stepTerminalNumberSetting(
    key: "fontSize" | "lineHeight",
    delta: number,
  ): Promise<void> {
    const limits = {
      fontSize: { min: 10, max: 24, decimals: 0 },
      lineHeight: { min: 1, max: 2, decimals: 1 },
    }[key];
    const nextValue = Math.min(
      Math.max(Number(appSettings.terminal[key]) + delta, limits.min),
      limits.max,
    );
    const normalizedValue = Number(nextValue.toFixed(limits.decimals));

    await updateTerminalSetting(key, normalizedValue);
  }

  function openSettingsDialog(): void {
    isSettingsDialogOpen.value = true;
  }

  function closeSettingsDialog(): void {
    isSettingsDialogOpen.value = false;
    isSelectionBackgroundDropdownOpen.value = false;
  }

  async function selectSelectionBackground(color: string): Promise<void> {
    isSelectionBackgroundDropdownOpen.value = false;
    await updateTerminalSetting("selectionBackground", color);
  }

  async function loadAppSettings(): Promise<void> {
    try {
      const savedSettings = await core.orbitSSHApi?.settings.get();

      if (!savedSettings) {
        return;
      }

      Object.assign(appSettings.terminal, savedSettings.terminal);
      core.writeRendererLog("应用设置加载完成", {
        terminal: savedSettings.terminal,
      });
    } catch (error) {
      core.writeRendererLog(
        "应用设置加载失败",
        { error: error instanceof Error ? error.message : String(error) },
        "error",
      );
    }
  }

  return {
    appSettings,
    isSettingsDialogOpen,
    isSelectionBackgroundDropdownOpen,
    activeSettingsSection,
    selectionBackgroundOptions,
    toPlainAppSettings,
    saveAppSettings,
    updateTerminalSetting,
    stepTerminalNumberSetting,
    openSettingsDialog,
    closeSettingsDialog,
    selectSelectionBackground,
    loadAppSettings,
  };
});
