import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readRendererStyles } from "./helpers/styles.mjs";

const ringPath = new URL("../../src/renderer/components/AiContextUsageRing.vue", import.meta.url);
const appPath = new URL("../../src/renderer/App.vue", import.meta.url);

test("输入框仅在模型配置上下文上限后显示用量圆环", async () => {
  const ring = await readFile(ringPath, "utf8");
  const app = await readFile(appPath, "utf8");
  const style = await readRendererStyles();

  assert.match(ring, /contextTokenLimitK[\s\S]*> 0/);
  assert.match(ring, /v-if="visible"/);
  assert.match(ring, /role="progressbar"/);
  assert.match(ring, /--ai-context-progress/);
  assert.match(app, /:context-usage="aiContextUsage"/);
  assert.match(style, /conic-gradient\(/);
});
