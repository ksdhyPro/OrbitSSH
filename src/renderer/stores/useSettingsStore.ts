import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import {
  defaultAppSettings,
  type AiSettings,
  type AppSettings,
  type AppThemeMode,
} from "../../shared/settings";
import { useCoreStore } from "./useCoreStore";

export const selectionBackgroundOptions = [
  "#244763",
  "#365A46",
  "#5B4B2A",
  "#543A5F",
  "#5A2D35",
];

function cloneAiSettings(value: AiSettings): AiSettings {
  return {
    ...value,
    configs: value.configs.map(config => ({
      ...config,
      reasoningEffortOptions: [...config.reasoningEffortOptions],
      inputModalities: [...config.inputModalities],
    })),
  };
}

export const useSettingsStore = defineStore("settings", () => {
  const core = useCoreStore();
  const appSettings = reactive<AppSettings>(
    structuredClone(defaultAppSettings),
  );
  const isSettingsDialogOpen = ref(false);
  const isSelectionBackgroundDropdownOpen = ref(false);
  const activeSettingsSection = ref<"general" | "ai" | "shortcuts">(
    "general",
  );

  function toPlainAppSettings(): AppSettings {
    return {
      appearance: {
        themeMode: appSettings.appearance.themeMode,
      },
      connection: {
        keepaliveIntervalSeconds:
          appSettings.connection.keepaliveIntervalSeconds,
        idleDisconnectMinutes: appSettings.connection.idleDisconnectMinutes,
      },
      terminal: {
        fontSize: appSettings.terminal.fontSize,
        lineHeight: appSettings.terminal.lineHeight,
        selectionBackground: appSettings.terminal.selectionBackground,
        openLocalTerminalOnStartup:
          appSettings.terminal.openLocalTerminalOnStartup,
      },
      update: {
        updateFeedUrl: appSettings.update.updateFeedUrl,
      },
      ai: {
        enabled: appSettings.ai.enabled,
        shareTerminalContext: appSettings.ai.shareTerminalContext,
        maxAttachmentSizeMb: appSettings.ai.maxAttachmentSizeMb,
        maxAgentCommandCount: appSettings.ai.maxAgentCommandCount,
        commandTimeoutMinutes: appSettings.ai.commandTimeoutMinutes,
        commandApprovalTimeoutMinutes:
          appSettings.ai.commandApprovalTimeoutMinutes,
        activeConfigId: appSettings.ai.activeConfigId,
        multimodalConfigId: appSettings.ai.multimodalConfigId,
        configs: cloneAiSettings(appSettings.ai).configs,
        defaultMode: appSettings.ai.defaultMode,
      },
    };
  }

  function applySavedSettings(savedSettings: AppSettings): void {
    Object.assign(appSettings.appearance, savedSettings.appearance);
    Object.assign(appSettings.connection, savedSettings.connection);
    Object.assign(appSettings.terminal, savedSettings.terminal);
    Object.assign(appSettings.update, savedSettings.update);
    Object.assign(appSettings.ai, savedSettings.ai);
  }

  async function saveAppSettings(): Promise<boolean> {
    const saveSettings = core.orbitSSHApi?.settings.save;
    if (!saveSettings) {
      core.writeRendererLog("Settings API is unavailable", undefined, "error");
      return false;
    }

    try {
      const savedSettings = await saveSettings(toPlainAppSettings());

      applySavedSettings(savedSettings);
      return true;
    } catch (error) {
      core.writeRendererLog(
        "Failed to save settings",
        { error: error instanceof Error ? error.message : String(error) },
        "error",
      );
      return false;
    }
  }

  async function updateTerminalSetting<K extends keyof AppSettings["terminal"]>(
    key: K,
    value: AppSettings["terminal"][K],
  ): Promise<void> {
    appSettings.terminal[key] = value;
    await saveAppSettings();
  }

  async function updateThemeMode(mode: AppThemeMode): Promise<void> {
    appSettings.appearance.themeMode = mode;
    await saveAppSettings();
  }

  async function updateKeepaliveIntervalSeconds(value: number): Promise<void> {
    appSettings.connection.keepaliveIntervalSeconds = value;
    await saveAppSettings();
  }

  async function updateIdleDisconnectMinutes(value: number): Promise<void> {
    appSettings.connection.idleDisconnectMinutes = value;
    await saveAppSettings();
  }

  async function updateOpenLocalTerminalOnStartup(value: boolean): Promise<void> {
    await updateTerminalSetting("openLocalTerminalOnStartup", value);
  }

  async function updateAiSetting<K extends keyof AiSettings>(
    key: K,
    value: AiSettings[K],
  ): Promise<void> {
    appSettings.ai[key] = value;
    await saveAppSettings();
  }

  // 保存完整 AI 配置，供设置页在前端校验通过后一次性写入。
  async function updateAiSettings(value: AiSettings): Promise<boolean> {
    const previousAiSettings = cloneAiSettings(appSettings.ai);
    Object.assign(appSettings.ai, cloneAiSettings(value));
    const saved = await saveAppSettings();
    if (!saved) Object.assign(appSettings.ai, previousAiSettings);
    return saved;
  }

  async function updateAiModelReasoning(value: {
    configId: string;
    reasoningEnabled: boolean;
    reasoningEffort: string;
  }): Promise<void> {
    const config = appSettings.ai.configs.find(item => item.id === value.configId);
    if (!config) return;

    config.reasoningEnabled = value.reasoningEnabled;
    config.reasoningEffort = value.reasoningEffort.trim() || config.reasoningEffort;
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

      applySavedSettings(savedSettings);
      core.writeRendererLog("Settings loaded", {
        appearance: savedSettings.appearance,
        connection: savedSettings.connection,
        terminal: savedSettings.terminal,
        ai: {
          enabled: savedSettings.ai.enabled,
          shareTerminalContext: savedSettings.ai.shareTerminalContext,
          maxAgentCommandCount: savedSettings.ai.maxAgentCommandCount,
          commandTimeoutMinutes: savedSettings.ai.commandTimeoutMinutes,
          commandApprovalTimeoutMinutes:
            savedSettings.ai.commandApprovalTimeoutMinutes,
          activeConfigId: savedSettings.ai.activeConfigId,
          configCount: savedSettings.ai.configs.length,
          defaultMode: savedSettings.ai.defaultMode,
          hasActiveApiKey: Boolean(
            savedSettings.ai.configs.find(
              config => config.id === savedSettings.ai.activeConfigId,
            )?.apiKey,
          ),
        },
      });
    } catch (error) {
      core.writeRendererLog(
        "Failed to load settings",
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
    updateKeepaliveIntervalSeconds,
    updateIdleDisconnectMinutes,
    updateOpenLocalTerminalOnStartup,
    updateAiSetting,
    updateAiSettings,
    updateAiModelReasoning,
    updateThemeMode,
    stepTerminalNumberSetting,
    openSettingsDialog,
    closeSettingsDialog,
    selectSelectionBackground,
    loadAppSettings,
  };
});
