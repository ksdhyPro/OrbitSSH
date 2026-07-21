import assert from "node:assert/strict";
import test from "node:test";

import {
  getAiRetryDelayMs,
  isRetryableAiNetworkError,
  isRetryableAiStatus,
  waitForAiRetry,
} from "../../dist-electron/main/ai/ai-retry.js";

test("AI 只对临时 HTTP 错误自动重试", () => {
  assert.equal(isRetryableAiStatus(429), true);
  assert.equal(isRetryableAiStatus(503), true);
  assert.equal(isRetryableAiStatus(400), false);
  assert.equal(isRetryableAiStatus(401), false);
});

test("AI 识别常见网络断连错误", () => {
  const error = new TypeError("fetch failed");
  error.cause = { code: "UND_ERR_SOCKET" };

  assert.equal(isRetryableAiNetworkError(error), true);
  assert.equal(isRetryableAiNetworkError(new SyntaxError("invalid JSON")), false);
});

test("AI 重试采用指数退避且可被取消", async () => {
  assert.equal(getAiRetryDelayMs(1), 500);
  assert.equal(getAiRetryDelayMs(2), 1000);
  assert.equal(getAiRetryDelayMs(10), 4000);

  const controller = new AbortController();
  const waiting = waitForAiRetry(1000, controller.signal);
  controller.abort();
  assert.equal(await waiting, false);
});
