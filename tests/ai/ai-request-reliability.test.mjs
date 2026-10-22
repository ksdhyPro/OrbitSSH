import assert from "node:assert/strict";
import test from "node:test";

import { createRequestDeadline } from "../../dist-electron/main/ai/ai-request-deadline.js";
import {
  AiProviderPayloadError,
  describeHttpFailure,
  describeRequestError,
  extractProviderErrorMessage,
  parseRetryAfterMs,
} from "../../dist-electron/main/ai/ai-request-errors.js";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("迟迟收不到响应头时按首字节超时停止", async () => {
  const deadline = createRequestDeadline({ firstByteMs: 20, idleMs: 1_000, totalMs: 1_000 });
  await wait(40);
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.reason, "first_byte");
});

test("持续输出的长回答不会被空闲超时打断，停止输出后才超时", async () => {
  const deadline = createRequestDeadline({ firstByteMs: 1_000, idleMs: 30, totalMs: 1_000 });
  deadline.markResponseStarted();
  for (let index = 0; index < 6; index += 1) {
    await wait(15);
    deadline.markActivity();
  }
  // 已经运行约 90ms，远超 30ms 的空闲上限，但一直有新数据所以仍未超时。
  assert.equal(deadline.signal.aborted, false);

  await wait(50);
  assert.equal(deadline.reason, "idle");
  deadline.dispose();
});

test("总时长上限不受持续输出影响", async () => {
  const deadline = createRequestDeadline({ firstByteMs: 1_000, idleMs: 1_000, totalMs: 40 });
  deadline.markResponseStarted();
  const keepAlive = setInterval(() => deadline.markActivity(), 5);
  await wait(60);
  clearInterval(keepAlive);
  assert.equal(deadline.reason, "total");
});

test("dispose 后不再触发超时", async () => {
  const deadline = createRequestDeadline({ firstByteMs: 10, idleMs: 10, totalMs: 10 });
  deadline.dispose();
  await wait(30);
  assert.equal(deadline.signal.aborted, false);
});

test("Retry-After 支持秒数和 HTTP 日期，并限制最长等待", () => {
  assert.equal(parseRetryAfterMs("2"), 2_000);
  assert.equal(parseRetryAfterMs("120"), 30_000);
  const now = Date.parse("2026-10-22T00:00:00Z");
  assert.equal(parseRetryAfterMs("Thu, 22 Oct 2026 00:00:05 GMT", now), 5_000);
  assert.equal(parseRetryAfterMs("not a date"), undefined);
  assert.equal(parseRetryAfterMs(null), undefined);
});

test("HTTP 错误给出可操作的中文说明并附带脱敏后的服务端原因", () => {
  const unauthorized = describeHttpFailure(401, JSON.stringify({ error: { message: "Invalid API key sk-abcdefghijklmnopqrstuvwxyz" } }));
  assert.equal(unauthorized.retryable, false);
  assert.match(unauthorized.message, /API Key 无效/);
  assert.match(unauthorized.message, /服务端说明：Invalid API key/);
  assert.doesNotMatch(unauthorized.message, /sk-abcdefghijklmnop/);

  assert.match(describeHttpFailure(404, "<html>not found</html>").message, /Base URL（通常以 \/v1 结尾）/);
  assert.doesNotMatch(describeHttpFailure(404, "<html>not found</html>").message, /html/);

  const limited = describeHttpFailure(429, "{}", "3");
  assert.equal(limited.retryable, true);
  assert.equal(limited.retryAfterMs, 3_000);
  assert.equal(describeHttpFailure(503, "").retryable, true);
  assert.equal(describeHttpFailure(400, JSON.stringify({ error: { message: "maximum context length exceeded" } })).contextLimitExceeded, true);
  assert.match(describeHttpFailure(422, JSON.stringify({ message: "temperature out of range" })).message, /temperature out of range/);
});

test("网络、证书、超时和响应格式问题分别给出具体原因", () => {
  const withCode = code => Object.assign(new TypeError("fetch failed"), { cause: { code } });

  assert.match(describeRequestError(withCode("ENOTFOUND")).message, /无法解析 AI 服务地址/);
  assert.match(describeRequestError(withCode("ECONNREFUSED")).message, /拒绝连接/);
  assert.match(describeRequestError(withCode("UND_ERR_CONNECT_TIMEOUT")).message, /连接超时/);
  assert.match(describeRequestError(withCode("SELF_SIGNED_CERT_IN_CHAIN")).message, /TLS 证书/);
  assert.match(describeRequestError(new SyntaxError("Unexpected token <")).message, /Base URL 指向 OpenAI 兼容接口/);
  assert.match(describeRequestError(new AiProviderPayloadError("model overloaded")).message, /AI 服务返回错误：model overloaded/);
  assert.match(describeRequestError(new Error("aborted"), "idle").message, /输出中断超过 60 秒/);
  assert.match(describeRequestError(new Error("aborted"), "first_byte").message, /长时间没有响应/);
  assert.equal(describeRequestError(new Error("AI_RESPONSE_TOO_LARGE")).retryable, false);
});

test("服务端错误说明只取结构化字段，不展示网页原文", () => {
  assert.equal(extractProviderErrorMessage(JSON.stringify({ error: "quota exceeded" })), "quota exceeded");
  assert.equal(extractProviderErrorMessage("<!doctype html><title>502</title>"), "");
});
