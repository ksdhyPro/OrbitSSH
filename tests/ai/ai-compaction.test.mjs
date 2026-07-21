import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareAiChatInput,
  selectCompactionSplitIndex,
  shouldCompactAiHistory,
} from "../../dist-electron/main/ai/ai-compaction.js";

function createHistory(count, contentLength = 1_000) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `history-${index}-` + "x".repeat(contentLength),
    createdAt: index + 1,
  }));
}

function createSettings(contextWindow = 4_096, maxOutputTokens = 512) {
  return {
    ai: {
      enabled: true,
      shareTerminalContext: true,
      maxAgentCommandCount: 20,
      commandApprovalTimeoutMinutes: 0,
      activeConfigId: "model",
      multimodalConfigId: "",
      defaultMode: "full",
      configs: [{
        id: "model",
        name: "Test model",
        spec: "openai",
        provider: "custom",
        providerName: "Custom",
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-secret",
        model: "test-model",
        contextWindow,
        maxOutputTokens,
        reasoningEnabled: true,
        reasoningParameter: "reasoning_effort",
        reasoningEffort: "high",
        reasoningEffortOptions: ["low", "high"],
        inputModalities: ["text"],
        supportsAttachments: false,
      }],
    },
  };
}

function createInput(history) {
  return {
    tabId: "tab-1",
    mode: "full",
    message: "继续处理",
    context: { tabId: "tab-1", serverName: "demo" },
    history,
    attachments: [],
  };
}

test("语义压缩在上下文达到阈值时触发，并保留最近两个 user turn", () => {
  const history = createHistory(12);
  const input = createInput(history);

  assert.equal(shouldCompactAiHistory(input, 4_096, 512), true);
  const splitIndex = selectCompactionSplitIndex(history, 3_584);
  const recent = history.slice(splitIndex);
  assert.ok(splitIndex > 0);
  assert.ok(recent.filter(message => message.role === "user").length >= 2);
});

test("模型生成滚动摘要，摘要请求不携带工具或思考参数", async t => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: [
            "目标与状态：继续排查服务。",
            "关键事实与决定：已检查磁盘。",
            "约束与偏好：使用中文。",
            "未完成工作：检查 nginx。",
          ].join("\n"),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const history = createHistory(12);
  const prepared = await prepareAiChatInput(
    createInput(history),
    createSettings(),
  );

  assert.ok(prepared.compaction);
  assert.match(prepared.compaction.content, /未完成工作/);
  assert.ok(prepared.input.history.length < history.length);
  assert.equal("tools" in requestBody, false);
  assert.equal("reasoning_effort" in requestBody, false);
  assert.equal(requestBody.stream, undefined);
  assert.equal(requestBody.max_tokens, 512);
});

test("摘要模型失败时保留旧摘要和原始增量历史", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("bad request", { status: 400 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const history = createHistory(12);
  const previousCompaction = {
    content: "旧摘要",
    coveredThroughMessageId: "old-message",
    coveredThroughCreatedAt: 0,
    updatedAt: 1,
  };
  const prepared = await prepareAiChatInput(
    { ...createInput(history), compaction: previousCompaction },
    createSettings(),
  );

  assert.deepEqual(prepared.compaction, previousCompaction);
  assert.equal(prepared.input.history.length, history.length);
});

test("单条超长消息会分段摘要，全部完成后才推进覆盖边界", async t => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: `目标与状态：已合并第 ${requestCount} 批。` } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const history = createHistory(12);
  history[0] = {
    ...history[0],
    content: "中".repeat(8_000),
  };
  const prepared = await prepareAiChatInput(
    createInput(history),
    createSettings(),
  );

  assert.ok(requestCount >= 3);
  assert.ok(prepared.compaction);
  assert.notEqual(prepared.compaction.coveredThroughMessageId, history[0].id);
  assert.ok(prepared.input.history.length < history.length);
});
