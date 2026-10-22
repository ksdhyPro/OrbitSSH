import assert from "node:assert/strict";
import test from "node:test";

import {
  AiConversationContextManager,
  calculateSummaryMaxTokens,
  compactCommandMemory,
  estimateCommandMemoryTokens,
  estimateTokenCount,
  getCommandMemoryBudget,
  getContextThresholdTokens,
  isContextBudgetReached,
  isContextWindowExceededError,
  isHistoryTooShortToSummarize,
} from "../../dist-electron/main/ai/ai-context-budget.js";

const input = {
  tabId: "tab-1",
  requestId: "request-1",
  conversationId: "conversation-1",
  mode: "auto",
  presetPrompt: "",
  conversationTitle: "检查服务",
  conversationCreatedAt: 1,
  messageId: "message-1",
  messageCreatedAt: 3,
  message: "继续检查",
  context: { tabId: "tab-1", serverId: "server-1" },
  history: [
    { id: "m1", role: "user", content: "检查服务", createdAt: 1 },
    { id: "m2", role: "assistant", content: "开始检查", createdAt: 2 },
  ],
};

test("Token 估算区分中文与英文：英文约 0.3、中文约 0.7、其他非 ASCII 字符按 1 计", () => {
  assert.equal(estimateTokenCount("1234567890"), 3);
  assert.equal(estimateTokenCount("检查磁盘使用率"), 5);
  assert.equal(estimateTokenCount("ＡＢ。かなㄅ한"), 5);
  assert.equal(estimateTokenCount("├──"), 3);
  assert.equal(estimateTokenCount("df -h 磁盘"), 4);
  assert.equal(estimateTokenCount(""), 0);
  assert.equal(getContextThresholdTokens(10), 8_000);
});

test("英文命令输出不再按两个字符一个 Token 高估", () => {
  const log = "Oct 22 10:00:01 host nginx[123]: GET /api/v1/items 200 0.012s\n".repeat(100);
  assert.ok(estimateTokenCount(log) <= Math.ceil(log.length * 0.3));
  assert.ok(estimateTokenCount(log) < log.length / 2);
});

test("上下文预算优先使用接口 usage，并在 80% 时触发", () => {
  assert.equal(
    isContextBudgetReached(10, 100, {
      promptTokens: 7_000,
      completionTokens: 1_000,
      totalTokens: 8_000,
      source: "provider",
    }),
    true,
  );
  assert.equal(isContextBudgetReached(10, 7_999), false);
});

test("上下文圆环用量按模型隔离，并限制在 100%", () => {
  const manager = new AiConversationContextManager();
  manager.recordUsage(
    input,
    {
      promptTokens: 9_000,
      completionTokens: 2_000,
      totalTokens: 11_000,
      source: "provider",
    },
    "model-a",
  );

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
    history: [
      {
        id: "large",
        role: "user",
        content: "x".repeat(100_000),
        createdAt: 1,
      },
    ],
  };

  assert.equal(manager.shouldCompress(oversizedInput, 0, "model-a"), false);
});

test("预提示词会计入上下文压缩预算", () => {
  const manager = new AiConversationContextManager();

  assert.equal(manager.shouldCompress(input, 5, "model-a"), false);
  assert.equal(
    manager.shouldCompress(
      {
        ...input,
        presetPrompt: "规则".repeat(2_500),
      },
      5,
      "model-a",
    ),
    true,
  );
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
  const maxTokens = calculateSummaryMaxTokens(longHistoryInput, { summary: "", commands: [] }, 128);

  assert.ok(maxTokens > 1_500);
  assert.ok(maxTokens <= estimateTokenCount(longHistoryInput.history) * 0.2);
});

function largeCommand(id, overrides = {}) {
  return {
    toolCallId: id,
    toolName: "run_shell_command",
    command: `journalctl -u nginx #${id}`,
    reason: "检查日志",
    risk: "low",
    result: {
      stdout: `${id} GET /api/items 200 upstream=127.0.0.1:8080\n`.repeat(400),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 10,
    },
    executedAt: 10,
    ...overrides,
  };
}

test("命令及回复占满新上下文时不再提交摘要请求", () => {
  const longHistoryInput = {
    ...input,
    history: [{ id: "long", role: "user", content: "x".repeat(40_000), createdAt: 1 }],
  };
  const commands = Array.from({ length: 30 }, (_, index) => largeCommand(`c${index}`));

  assert.equal(calculateSummaryMaxTokens(longHistoryInput, { summary: "", commands }, 10), 0);
});

test("命令记忆按实际发送的截断后内容估算，不按保存的原始输出", () => {
  const command = largeCommand("c1");
  const rawTokens = estimateTokenCount(command.result.stdout);
  const promptTokens = estimateCommandMemoryTokens([command]);

  assert.ok(rawTokens > 4_000);
  assert.ok(promptTokens < 1_500);
});

test("命令记忆从最新往前保留，超出后降级为末尾输出，再超出则移除最早的命令", () => {
  const commands = Array.from({ length: 40 }, (_, index) => largeCommand(`c${index}`));
  const budget = getCommandMemoryBudget(32);
  const kept = compactCommandMemory(commands, budget);
  const full = kept.filter(command => !command.compacted);
  const compacted = kept.filter(command => command.compacted);

  assert.ok(kept.length < commands.length);
  assert.ok(full.length > 0 && compacted.length > 0);
  // 保留的是最新的连续一段，顺序不变：较早的降级在前，最近的完整结果在后。
  assert.deepEqual(
    kept.map(command => command.toolCallId),
    commands.slice(-kept.length).map(command => command.toolCallId),
  );
  assert.ok(kept.findIndex(command => !command.compacted) === compacted.length);
  assert.ok(estimateCommandMemoryTokens(full) <= budget.fullTokens);
  assert.ok(estimateCommandMemoryTokens(compacted) <= budget.compactedTokens);
  // 降级只保留末尾输出并说明已压缩。
  assert.match(compacted[0].result.stdout, /较早的命令结果已压缩/);
  assert.ok(compacted[0].result.stdout.endsWith("upstream=127.0.0.1:8080"));
  assert.ok(compacted[0].result.stdout.length < 400);
});

test("已降级的命令保持不变，再次降级时请求前缀稳定", () => {
  const commands = Array.from({ length: 40 }, (_, index) => largeCommand(`c${index}`));
  const budget = getCommandMemoryBudget(32);
  const once = compactCommandMemory(commands, budget);
  const twice = compactCommandMemory(once, budget);

  assert.deepEqual(twice, once);
  twice.forEach((command, index) => assert.equal(command, once[index]));
});

test("命令降级前先脱敏，截取末尾不会留下半截私钥", () => {
  const privateKey = [
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "a".repeat(600),
    "-----END OPENSSH PRIVATE KEY-----",
  ].join("\n");
  const [compacted] = compactCommandMemory(
    [largeCommand("key", { result: { ...largeCommand("key").result, stdout: privateKey } })],
    { fullTokens: 0, compactedTokens: 10_000 },
  );

  assert.equal(compacted.compacted, true);
  assert.doesNotMatch(compacted.result.stdout, /aaaa|PRIVATE KEY-----/);
  assert.match(compacted.result.stdout, /已脱敏：私钥/);
});

test("模型报告超限后按一半预算更激进地降级；未配置上限时按 32K 窗口计算", () => {
  assert.deepEqual(getCommandMemoryBudget(32), { fullTokens: 9_600, compactedTokens: 3_200 });
  assert.deepEqual(getCommandMemoryBudget(32, true), { fullTokens: 4_800, compactedTokens: 1_600 });
  assert.deepEqual(getCommandMemoryBudget(0), getCommandMemoryBudget(32));
});

test("命令降级后清除旧的接口用量，避免旧用量继续触发压缩", () => {
  const manager = new AiConversationContextManager();
  for (let index = 0; index < 40; index += 1) {
    manager.recordCommand(input, largeCommand(`c${index}`));
  }
  manager.recordUsage(
    input,
    { promptTokens: 30_000, completionTokens: 10, totalTokens: 30_010, source: "provider" },
    "model-a",
  );
  assert.equal(manager.shouldCompress(input, 32, "model-a"), true);

  assert.equal(manager.compactCommands(input, getCommandMemoryBudget(32)), true);
  assert.equal(manager.shouldCompress(input, 32, "model-a"), false);
  assert.equal(manager.compactCommands(input, getCommandMemoryBudget(32)), false);
  assert.ok(manager.snapshot(input).commands.some(command => command.compacted));
});

test("历史太短时跳过摘要请求", () => {
  assert.equal(isHistoryTooShortToSummarize(input.history), true);
  assert.equal(
    isHistoryTooShortToSummarize([
      { id: "long", role: "user", content: "内容".repeat(2_000), createdAt: 1 },
    ]),
    false,
  );
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
    history: [...input.history, { id: "m3", role: "user", content: "再看日志", createdAt: 3 }],
  };
  assert.deepEqual(
    manager.getSegmentHistory(nextInput).map(message => message.id),
    ["m3"],
  );
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

test("同一服务器会话可在其他标签页恢复运行上下文", () => {
  const manager = new AiConversationContextManager();
  const restoredInput = {
    ...input,
    tabId: "tab-2",
    context: { ...input.context, tabId: "tab-2" },
  };
  manager.restore(restoredInput, {
    summary: "已经确认 nginx 正常运行。",
    historyFloorCreatedAt: 2,
    commands: [],
  });

  assert.equal(manager.getMemory(restoredInput).summary, "已经确认 nginx 正常运行。");
  assert.deepEqual(manager.snapshot(restoredInput), {
    summary: "已经确认 nginx 正常运行。",
    historyFloorCreatedAt: 2,
    commands: [],
  });
});

test("内存只保留最近使用的对话状态，淘汰后从持久化上下文恢复且不丢失记忆", () => {
  const persisted = new Map();
  const loads = [];
  const manager = new AiConversationContextManager({
    maxStates: 2,
    loadSnapshot: (serverId, conversationId) => {
      loads.push(conversationId);
      return persisted.get(`${serverId}/${conversationId}`) ?? null;
    },
  });
  const conversation = id => ({ ...input, conversationId: id });
  const command = {
    toolCallId: "call-1",
    toolName: "run_shell_command",
    command: "df -h",
    reason: "查看磁盘",
    risk: "low",
    result: { stdout: "ok", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 },
  };

  manager.recordCommand(conversation("a"), command);
  persisted.set("server-1/a", manager.snapshot(conversation("a")));
  manager.getMemory(conversation("b"));
  manager.getMemory(conversation("c"));
  assert.equal(manager.size, 2);

  // a 已被淘汰，再次访问时按需从持久化上下文恢复命令记忆。
  assert.deepEqual(
    manager.getMemory(conversation("a")).commands.map(item => item.command),
    ["df -h"],
  );
  assert.equal(loads.filter(id => id === "a").length, 2);
  assert.equal(manager.size, 2);
});

test("删除服务器时清理该服务器全部对话状态", () => {
  const manager = new AiConversationContextManager();
  const onServer = (serverId, conversationId) => ({
    ...input,
    conversationId,
    context: { ...input.context, serverId },
  });
  manager.getMemory(onServer("server-1", "a"));
  manager.getMemory(onServer("server-1", "b"));
  manager.getMemory(onServer("server-2", "c"));

  manager.clearServer("server-1");
  assert.equal(manager.size, 1);
});
