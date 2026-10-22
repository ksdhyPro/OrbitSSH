import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AI_DISABLED_MESSAGE,
  AI_MODEL_NOT_CONFIGURED_MESSAGE,
  getAiUnavailableMessage,
  inferAiProvider,
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

test("按 Base URL 的官方域名识别 DeepSeek 与 GLM，其他地址保持 other", () => {
  assert.equal(inferAiProvider("https://api.deepseek.com/v1"), "deepseek");
  assert.equal(inferAiProvider("https://API.DeepSeek.com"), "deepseek");
  assert.equal(inferAiProvider("https://open.bigmodel.cn/api/paas/v4"), "glm");
  assert.equal(inferAiProvider("https://api.z.ai/api/paas/v4"), "glm");

  // 仿冒域名、代理网关和无效地址都不能被识别为已知服务。
  for (const baseUrl of [
    "https://deepseek.com.evil.example/v1",
    "https://notdeepseek.com/v1",
    "https://bigmodel.cn.proxy.example/v4",
    "https://gateway.example.com/deepseek/v1",
    "http://127.0.0.1:8080/v1",
    "not a url",
  ]) {
    assert.equal(inferAiProvider(baseUrl), "other", baseUrl);
  }
});

test("只在 provider 为 other 时按 Base URL 推断，已明确的 provider 保持不变", () => {
  const resolve = config =>
    resolveActiveAiConfig(createSettings({ configs: [config], activeConfigId: config.id }));

  assert.equal(resolve({ ...completeConfig, provider: "other" }).provider, "deepseek");
  assert.equal(
    resolve({ ...completeConfig, provider: "other", baseUrl: "https://llm.example.com/v1" })
      .provider,
    "other",
  );
  assert.equal(
    resolve({ ...completeConfig, provider: "deepseek", baseUrl: "https://llm.example.com/v1" })
      .provider,
    "deepseek",
  );
});

test("模型不可用时明确告知原因", () => {
  assert.equal(getAiUnavailableMessage(createSettings()), AI_MODEL_NOT_CONFIGURED_MESSAGE);
  assert.equal(getAiUnavailableMessage(createSettings({ enabled: false })), AI_DISABLED_MESSAGE);
  assert.match(AI_MODEL_NOT_CONFIGURED_MESSAGE, /设置 → AI → 模型配置/);
});

test("未配置模型时不再伪造回复或建议命令", async () => {
  // ai-provider 依赖 SSH 会话，无法在纯 Node 环境加载，这里确认它不再包含本地兜底命令。
  const source = await readFile(
    new URL("../../src/main/ai/ai-provider.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /createLocalFallback/);
  assert.doesNotMatch(source, /command: "df -h"|systemctl status nginx/);
  assert.match(source, /return \{ reply: getAiUnavailableMessage\(settings\), commands: \[\] \}/);
});
