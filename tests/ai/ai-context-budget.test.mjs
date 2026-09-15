import assert from "node:assert/strict";
import test from "node:test";

import {
  AiConversationContextManager,
  calculateSummaryMaxTokens,
  estimateTokenCount,
  getContextThresholdTokens,
  isContextBudgetReached,
  isContextWindowExceededError,
} from "../../dist-electron/main/ai/ai-context-budget.js";

const input = {
  tabId: "tab-1",
  requestId: "request-1",
  conversationId: "conversation-1",
  mode: "auto",
  message: "继续检查",
  context: { tabId: "tab-1" },
  history: [
    { id: "m1", role: "user", content: "检查服务", createdAt: 1 },
    { id: "m2", role: "assistant", content: "开始检查", createdAt: 2 },
  ],
};

test("Token 使用固定两个字符约等于一个 Token 的粗算规则", () => {
  assert.equal(estimateTokenCount("1234"), 2);
  assert.equal(getContextThresholdTokens(10), 8_000);
});

test("上下文预算优先使用接口 usage，并在 80% 时触发", () => {
  assert.equal(isContextBudgetReached(10, 100, {
    promptTokens: 7_000,
    completionTokens: 1_000,
    totalTokens: 8_000,
    source: "provider",
  }), true);
  assert.equal(isContextBudgetReached(10, 7_999), false);
});

test("上下文圆环用量按模型隔离，并限制在 100%", () => {
  const manager = new AiConversationContextManager();
  manager.recordUsage(input, {
    promptTokens: 9_000,
    completionTokens: 2_000,
    totalTokens: 11_000,
    source: "provider",
  }, "model-a");

  assert.deepEqual(manager.getContextUsage(input, "model-a", 10), {
    configId: "model-a",
    usedTokens: 11_000,
    maxTokens: 10_000,
    percent: 100,
    source: "provider",
  });
  assert.equal(manager.getContextUsage(input, "model-a", 0), undefined);
  assert.equal(manager.getContextUsage(input, "model-b", 10)?.percent, 0);
});

test("未配置上下文上限时不会主动压缩", () => {
  const manager = new AiConversationContextManager();
  const oversizedInput = {
    ...input,
    history: [{
      id: "large",
      role: "user",
      content: "x".repeat(100_000),
      createdAt: 1,
    }],
  };

  assert.equal(manager.shouldCompress(oversizedInput, 0, "model-a"), false);
});

test("只把明确的模型窗口错误识别为上下文溢出", () => {
  assert.equal(isContextWindowExceededError(400, '{"code":"context_length_exceeded"}'), true);
  assert.equal(isContextWindowExceededError(413, ""), true);
  assert.equal(isContextWindowExceededError(400, "invalid api key"), false);
});

test("摘要上限随历史规模动态增长，不再固定为 1500 Token", () => {
  const longHistoryInput = {
    ...input,
    history: Array.from({ length: 5 }, (_, index) => ({
      id: `long-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(8_000),
      createdAt: index + 1,
    })),
  };
  const maxTokens = calculateSummaryMaxTokens(
    longHistoryInput,
    { summary: "", commands: [] },
    128,
  );

  assert.ok(maxTokens > 1_500);
  assert.ok(maxTokens <= estimateTokenCount(longHistoryInput.history) * 0.2);
});

test("命令及回复占满新上下文时不再提交摘要请求", () => {
  const command = {
    toolCallId: "large-call",
    toolName: "run_shell_command",
    command: "journalctl -u nginx",
    reason: "检查日志",
    risk: "low",
    result: {
      stdout: "x".repeat(20_000),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 10,
    },
  };

  assert.equal(calculateSummaryMaxTokens(input, {
    summary: "",
    commands: [command],
  }, 10), 0);
});

test("压缩后只发送新上下文段历史，同时保留命令及命令回复", () => {
  const manager = new AiConversationContextManager();
  manager.recordCommand(input, {
    toolCallId: "call-1",
    toolName: "run_shell_command",
    command: "systemctl status nginx",
    reason: "检查服务",
    risk: "low",
    result: {
      stdout: "active (running)",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 10,
    },
  });
  manager.completeCompression(input, "用户正在检查 nginx 服务。");

  const nextInput = {
    ...input,
    history: [
      ...input.history,
      { id: "m3", role: "user", content: "再看日志", createdAt: 3 },
    ],
  };
  assert.deepEqual(manager.getSegmentHistory(nextInput).map(message => message.id), ["m3"]);
  const memory = manager.getMemory(nextInput);
  assert.equal(memory.summary, "用户正在检查 nginx 服务。");
  assert.equal(memory.commands[0].command, "systemctl status nginx");
  assert.equal(memory.commands[0].result.stdout, "active (running)");
});

test("压缩失败后当前对话直接熔断", () => {
  const manager = new AiConversationContextManager();
  manager.failCompression(input);
  assert.throws(() => manager.assertAvailable(input), /已停止继续请求模型/);
});
