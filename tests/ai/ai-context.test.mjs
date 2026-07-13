import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiMessages,
  redactSensitiveTerminalText,
} from "../../dist-electron/main/ai/ai-context.js";

const input = {
  tabId: "tab-1",
  mode: "full",
  message: "检查服务",
  context: { tabId: "tab-1", serverName: "demo" },
  history: [],
};

test("终端敏感信息会被脱敏", () => {
  const source = [
    "Authorization: Bearer secret-token",
    "password=hunter2",
    "https://user:pass@example.com/path",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
  ].join("\n");
  const redacted = redactSensitiveTerminalText(source);
  assert.doesNotMatch(redacted, /secret-token|hunter2|user:pass|PRIVATE KEY-----\nsecret/);
  assert.match(redacted, /已脱敏/);
});

test("默认空终端上下文不会生成最近终端输出块", () => {
  const messages = buildAiMessages(input, [], "");
  assert.equal(messages.some(message => message.content.includes("不可信最近终端输出")), false);
});

test("本地策略拦截会以结构化反馈发送给模型", () => {
  const feedback = {
    type: "local_command_policy_rejection",
    retryCount: 1,
    maxRetries: 3,
    command: "nginx -v 2>&1; echo \\",
    decision: "deny",
    reason: "命令以未完成的转义符结尾",
  };
  const messages = buildAiMessages(input, [], "", feedback);
  const systemMessage = messages[0].content;
  const contextMessage = messages.at(-2).content;

  assert.match(systemMessage, /本地策略概要/);
  assert.match(contextMessage, /本地命令策略反馈/);
  assert.match(contextMessage, /"retryCount":1/);
  assert.match(contextMessage, /未完成的转义符/);
});

test("命令结果与终端输出受总量限制", () => {
  const result = { stdout: "x".repeat(10_000), stderr: "", exitCode: 0, timedOut: false, durationMs: 1 };
  const executed = Array.from({ length: 10 }, (_, index) => ({
    command: `check-${index}`,
    reason: "检查",
    risk: "low",
    result,
  }));
  const messages = buildAiMessages(input, executed, "y".repeat(10_000));
  const contextMessage = messages.at(-2).content;
  assert.ok(contextMessage.length < 30_000);
  assert.match(contextMessage, /已截断/);
});
