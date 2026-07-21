import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveAiConfig,
} from "../../dist-electron/main/ai/ai-model-selection.js";
import { getAttachmentInputModality } from "../../dist-electron/shared/ai-model-capabilities.js";

function createConfig(id, inputModalities, supportsAttachments) {
  return {
    id,
    name: id,
    spec: "openai",
    provider: "custom",
    providerName: "Custom",
    baseUrl: ` https://api.example.test/${id}/ `,
    apiKey: " secret-key ",
    model: ` ${id}-model `,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    reasoningMode: "none",
    reasoningEnabled: true,
    reasoningEffort: "medium",
    inputModalities,
    supportsAttachments,
  };
}

const textConfig = createConfig("text", ["text"], false);
const visionConfig = createConfig("vision", ["text", "image", "video"], true);
const settings = {
  ai: {
    enabled: true,
    activeConfigId: "text",
    multimodalConfigId: "vision",
    configs: [textConfig, visionConfig],
  },
};
const baseInput = { attachments: [] };
const image = {
  name: "screen.png",
  mimeType: "image/png",
  size: 1,
  dataUrl: "data:image/png;base64,YQ==",
};

test("普通对话使用当前模型，附件对话切换到专用多模态模型", () => {
  const regular = getActiveAiConfig(settings, baseInput);
  const multimodal = getActiveAiConfig(settings, { attachments: [image] });

  assert.equal(regular.id, "text");
  assert.equal(multimodal.id, "vision");
  assert.equal(multimodal.baseUrl, "https://api.example.test/vision");
  assert.equal(multimodal.apiKey, "secret-key");
  assert.equal(multimodal.model, "vision-model");
});

test("专用模型不支持附件类型时拒绝路由", () => {
  const pdf = {
    ...image,
    name: "manual.pdf",
    mimeType: "application/pdf",
    dataUrl: "data:application/pdf;base64,YQ==",
  };

  assert.equal(getActiveAiConfig(settings, { attachments: [pdf] }), null);
});

test("附件 MIME 类型会映射为可配置的输入模态", () => {
  assert.equal(getAttachmentInputModality({ mimeType: "IMAGE/PNG" }), "image");
  assert.equal(getAttachmentInputModality({ mimeType: "audio/mpeg" }), "audio");
  assert.equal(getAttachmentInputModality({ mimeType: "video/mp4" }), "video");
  assert.equal(getAttachmentInputModality({ mimeType: "application/pdf" }), "pdf");
  assert.equal(getAttachmentInputModality({ mimeType: "text/plain" }), "file");
});
