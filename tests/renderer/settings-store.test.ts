import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../src/renderer/stores/useSettingsStore";
import {
  SFTP_TRANSFER_CONCURRENCY_MAX,
  SFTP_TRANSFER_CONCURRENCY_MIN,
  defaultAppSettings,
  type AppSettings,
} from "../../src/shared/settings";
import { installOrbitApiMock } from "./helpers/orbit-api";

describe("默认设置", () => {
  it("跨服务器操作与第三方 MCP 访问默认全部关闭", () => {
    expect(defaultAppSettings.ai.allowCrossServerOperations).toBe(false);
    expect(defaultAppSettings.ai.allowMcpAccess).toBe(false);
    expect(defaultAppSettings.ai.allowMcpSftpAccess).toBe(false);
  });

  it("SFTP 传输并发默认 3，可选范围 1 到 5", () => {
    expect(defaultAppSettings.connection.sftpMaxConcurrentTransfers).toBe(3);
    expect(SFTP_TRANSFER_CONCURRENCY_MIN).toBe(1);
    expect(SFTP_TRANSFER_CONCURRENCY_MAX).toBe(5);
  });
});

describe("useSettingsStore 保存", () => {
  let mock: ReturnType<typeof installOrbitApiMock>;

  beforeEach(() => {
    mock = installOrbitApiMock();
    setActivePinia(createPinia());
  });

  function lastSavedSettings(): AppSettings {
    return mock.api.settings.save.mock.calls.at(-1)![0] as AppSettings;
  }

  it.each([
    ["allowCrossServerOperations", true],
    ["allowMcpAccess", true],
    ["allowMcpSftpAccess", true],
    ["presetPrompt", "所有回答使用表格"],
  ] as const)("单项更新 AI 设置 %s 后随完整设置一起保存", async (key, value) => {
    const store = useSettingsStore();

    await store.updateAiSetting(key, value);

    expect(lastSavedSettings().ai[key]).toBe(value);
  });

  it("整体保存 AI 配置时保留全部开关与预提示词", async () => {
    const store = useSettingsStore();

    await store.updateAiSettings({
      ...structuredClone(defaultAppSettings.ai),
      allowCrossServerOperations: true,
      allowMcpAccess: true,
      allowMcpSftpAccess: true,
      presetPrompt: "先给结论",
    });

    expect(lastSavedSettings().ai).toMatchObject({
      allowCrossServerOperations: true,
      allowMcpAccess: true,
      allowMcpSftpAccess: true,
      presetPrompt: "先给结论",
    });
  });

  it("提交给主进程的是可结构化克隆的普通对象", async () => {
    const store = useSettingsStore();

    await store.updateSftpMaxConcurrentTransfers(5);

    const saved = lastSavedSettings();
    expect(saved.connection.sftpMaxConcurrentTransfers).toBe(5);
    expect(() => structuredClone(saved)).not.toThrow();
  });
});
