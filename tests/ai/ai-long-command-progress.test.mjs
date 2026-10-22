import assert from "node:assert/strict";
import test from "node:test";

import {
  LONG_COMMAND_IDLE_MESSAGE,
  createLongCommandProgressReporter,
  formatLongCommandElapsed,
} from "../../dist-electron/main/ai/ai-long-command-progress.js";

function createHarness(summary = "镜像下载到 60%") {
  const messages = [];
  const events = [];
  const requests = [];
  let nextId = 0;
  const report = createLongCommandProgressReporter({
    messages,
    emit: {
      sendMessageStart: (id, createdAt) => events.push(["start", id, createdAt]),
      sendChunk: (id, text) => events.push(["chunk", id, text]),
      replaceMessage: (id, text) => events.push(["replace", id, text]),
      sendCommandCard: () => undefined,
    },
    createMessage: content => ({ id: `m${++nextId}`, role: "assistant", content, createdAt: nextId }),
    requestProgressMessage: async progress => {
      requests.push(progress);
      return summary;
    },
  });
  return { report, messages, events, requests };
}

function progress(overrides = {}) {
  return {
    toolCallId: "long-1",
    command: "docker pull nginx",
    reason: "拉取镜像",
    risk: "medium",
    elapsedMs: 30_000,
    stdoutDelta: "",
    stderrDelta: "",
    outputChanged: false,
    ...overrides,
  };
}

test("没有新增输出时不请求模型，只在本地更新已运行时长", async () => {
  const { report, messages, requests } = createHarness();

  await report(progress(), new AbortController().signal);

  assert.equal(requests.length, 0);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, new RegExp(LONG_COMMAND_IDLE_MESSAGE));
  assert.match(messages[0].content, /已运行 30 秒/);
});

test("有新增输出时请求模型概括，多次汇报合并为同一条原地更新的消息", async () => {
  const { report, messages, events, requests } = createHarness();
  const signal = new AbortController().signal;

  await report(progress({ outputChanged: true, stdoutDelta: "60%" }), signal);
  await report(progress({ elapsedMs: 90_000 }), signal);
  await report(progress({ outputChanged: true, stdoutDelta: "80%", elapsedMs: 210_000 }), signal);

  assert.equal(requests.length, 2);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /镜像下载到 60%[\s\S]*已运行 3 分 30 秒/);
  assert.deepEqual(events.map(([type]) => type), ["start", "chunk", "replace", "replace"]);
  assert.ok(events.every(([, id]) => id === "m1"));
});

test("汇报期间请求被取消时不再更新消息", async () => {
  const { report, messages } = createHarness();
  const controller = new AbortController();
  controller.abort();

  await report(progress({ outputChanged: true }), controller.signal);
  assert.equal(messages.length, 0);
});

test("已运行时长按小时、分钟、秒展示", () => {
  assert.equal(formatLongCommandElapsed(5_400), "5 秒");
  assert.equal(formatLongCommandElapsed(125_000), "2 分 5 秒");
  assert.equal(formatLongCommandElapsed(3_900_000), "1 小时 5 分");
});
