import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAiModelCatalog } from "../../dist-electron/main/ai/ai-catalog.js";
import { DEFAULT_CUSTOM_AI_CONTEXT_WINDOW } from "../../dist-electron/shared/settings.js";

test("models.dev 目录会归一化厂商、模型能力与推理选项", () => {
  const catalog = normalizeAiModelCatalog({
    moonshotai: {
      name: "Moonshot AI",
      api: "https://api.moonshot.ai/v1",
      npm: "@ai-sdk/openai-compatible",
      doc: "https://example.test/docs",
      models: {
        "kimi-k3": {
          id: "kimi-k3",
          name: "Kimi K3",
          attachment: true,
          reasoning: true,
          reasoning_options: [
            { type: "toggle" },
            { type: "effort", values: ["low", "high", "max"] },
            { type: "budget_tokens", min: 1024, max: 32768 },
          ],
          modalities: { input: ["text", "image", "video"], output: ["text"] },
          limit: { context: 1_048_576, output: 131_072 },
        },
      },
    },
    empty: { name: "Empty", models: {} },
  }, 123);

  assert.equal(catalog.fetchedAt, 123);
  assert.equal(catalog.providers.length, 1);
  const provider = catalog.providers[0];
  const model = provider.models[0];
  assert.equal(provider.id, "moonshotai");
  assert.equal(provider.api, "https://api.moonshot.ai/v1");
  assert.equal(provider.npm, "@ai-sdk/openai-compatible");
  assert.equal(model.id, "kimi-k3");
  assert.equal(model.contextWindow, 1_048_576);
  assert.equal(model.maxOutputTokens, 131_072);
  assert.deepEqual(model.modalities.input, ["text", "image", "video"]);
  assert.deepEqual(model.reasoningOptions, [
    { type: "toggle" },
    { type: "effort", values: ["low", "high", "max"] },
    { type: "budget_tokens", min: 1024, max: 32768 },
  ]);
});

test("目录解析会过滤无 ID 模型和未知模态", () => {
  const catalog = normalizeAiModelCatalog({
    vendor: {
      models: {
        valid: {
          id: "valid",
          modalities: { input: ["text", "unknown", "image"] },
        },
        invalid: { name: "missing id" },
      },
    },
  }, 456);

  assert.equal(catalog.providers[0].models.length, 1);
  assert.deepEqual(catalog.providers[0].models[0].modalities.input, ["text", "image"]);
});

test("未知或自定义模型使用 200K 上下文回退值", () => {
  assert.equal(DEFAULT_CUSTOM_AI_CONTEXT_WINDOW, 200_000);
});
