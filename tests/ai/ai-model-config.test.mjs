import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AI_DISABLED_MESSAGE,
  AI_MODEL_NOT_CONFIGURED_MESSAGE,
  getAiUnavailableMessage,
  resolveActiveAiConfig,
} from "../../dist-electron/main/ai/ai-model-config.js";
import { defaultAppSettings } from "../../dist-electron/shared/settings.js";

function createSettings(ai = {}) {
  const settings = structuredClone(defaultAppSettings);
  settings.ai = { ...settings.ai, enabled: true, ...ai };
  return settings;
}

const completeConfig = {
  id: "deepseek",
  name: "DeepSeek",
  provider: "deepseek",
  baseUrl: " https://api.deepseek.com/v1/ ",
  apiKey: " sk-test ",
  model: " deepseek-chat ",
  contextTokenLimitK: 64,
};

test("只有 AI 开启且模型字段完整时才返回规范化后的配置", () => {
  const config = resolveActiveAiConfig(
    createSettings({ configs: [completeConfig], activeConfigId: "deepseek" }),
  );
  assert.equal(config.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(config.apiKey, "sk-test");
  assert.equal(config.model, "deepseek-chat");

  assert.equal(resolveActiveAiConfig(createSettings({ configs: [] })), null);
  assert.equal(
    resolveActiveAiConfig(createSettings({ configs: [{ ...completeConfig, apiKey: "  " }] })),
    null,
  );
  assert.equal(
    resolveActiveAiConfig(createSettings({ enabled: false, configs: [completeConfig] })),
    null,
  );
});

test("模型不可用时明确告知原因", () => {
  assert.equal(getAiUnavailableMessage(createSettings()), AI_MODEL_NOT_CONFIGURED_MESSAGE);
  assert.equal(getAiUnavailableMessage(createSettings({ enabled: false })), AI_DISABLED_MESSAGE);
  assert.match(AI_MODEL_NOT_CONFIGURED_MESSAGE, /设置 → AI → 模型配置/);
});

test("未配置模型时不再伪造回复或建议命令", async () => {
  // ai-provider 依赖 SSH 会话，无法在纯 Node 环境加载，这里确认它不再包含本地兜底命令。
  const source = await readFile(new URL("../../src/main/ai/ai-provider.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createLocalFallback/);
  assert.doesNotMatch(source, /command: "df -h"|systemctl status nginx/);
  assert.match(source, /return \{ reply: getAiUnavailableMessage\(settings\), commands: \[\] \}/);
});
