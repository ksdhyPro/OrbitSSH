// 需要 node --experimental-test-module-mocks：替换依赖 Electron 与 SSH 的模块，其余链路使用真实实现。
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

import { createAiConversationRepository } from "../../dist-electron/main/storage/ai-conversation-repository.js";
import { CachedStore } from "../../dist-electron/main/storage/cached-store.js";
import { defaultAppSettings } from "../../dist-electron/shared/settings.js";

const distUrl = relativePath =>
  new URL(`../../dist-electron/main/${relativePath}`, import.meta.url).href;

// ---- 测试替身：终端执行、对话存储、模型接口 ----
const terminal = {
  calls: [],
  execute: async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 }),
};
const storeDirectory = await mkdtemp(path.join(os.tmpdir(), "orbitssh-agent-"));
const storeFile = path.join(storeDirectory, "ai-conversations.json");
const initialStore = { conversationsByServer: {}, runtimeContextsByServer: {} };
await writeFile(storeFile, JSON.stringify(initialStore));
const conversationStore = new CachedStore({
  path: storeFile,
  store: structuredClone(initialStore),
});
const repository = createAiConversationRepository(conversationStore);

mock.module(distUrl("logger.js"), {
  namedExports: { writeAppLog: () => undefined, getAppLogPath: () => "", getAppLogDir: () => "" },
});
mock.module(distUrl("ssh/session-manager.js"), {
  namedExports: {
    getTerminalContextSnapshot: () => null,
    executeTerminalCommand: async (tabId, command, options) => {
      terminal.calls.push({ tabId, command, options });
      return terminal.execute(command, options);
    },
  },
});
mock.module(distUrl("ai/ai-saved-server-command.js"), {
  namedExports: {
    resolveSavedServerTargetFromStore: () => {
      throw new Error("测试中不涉及跨服务器命令");
    },
    executeSavedServerCommand: async () => {
      throw new Error("测试中不涉及跨服务器命令");
    },
  },
});
mock.module(distUrl("storage/ai-conversation-store.js"), { namedExports: repository });
const protocols = new Map();
mock.module(distUrl("storage/ai-protocol-store.js"), {
  namedExports: {
    getRememberedProtocol: key => protocols.get(key)?.protocol,
    rememberProtocol: (key, protocol) => protocols.set(key, { ...protocols.get(key), protocol }),
    isToolChoiceUnsupported: (key, protocol) =>
      protocols.get(key)?.toolChoice?.includes(protocol) ?? false,
    rememberToolChoiceUnsupported: (key, protocol) =>
      protocols.set(key, {
        ...protocols.get(key),
        toolChoice: [...(protocols.get(key)?.toolChoice ?? []), protocol],
      }),
  },
});

const runtime = await import(distUrl("ai/ai-agent-runtime.js"));

const model = { requests: [], responses: [], urls: [] };
globalThis.fetch = async (url, init) => {
  model.urls.push(String(url));
  if (String(url).endsWith("/responses")) {
    return new Response('{"error":{"message":"not found"}}', { status: 404 });
  }
  const body = JSON.parse(init.body);
  model.requests.push(body);
  const next = model.responses.shift();
  if (!next) throw new Error("模型替身没有更多预设回复");
  return typeof next === "function" ? next(body) : next;
};

function toolCall(name, args) {
  return Response.json({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: `call-${model.requests.length}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
  });
}
const finish = message => toolCall("finish_response", { message });
const shell = (command, risk = "low") =>
  toolCall("run_shell_command", { command, reason: "测试", risk });
const summary = text => Response.json({ choices: [{ message: { content: text } }] });

function createSettings(overrides = {}) {
  const settings = structuredClone(defaultAppSettings);
  settings.ai = {
    ...settings.ai,
    enabled: true,
    configs: [
      {
        id: "mock",
        name: "Mock",
        provider: "other",
        baseUrl: "http://mock.local/v1",
        apiKey: "test",
        model: "mock",
        contextTokenLimitK: 0,
        ...overrides,
      },
    ],
    activeConfigId: "mock",
  };
  return settings;
}

let sequence = 0;
function createInput(overrides = {}) {
  sequence += 1;
  return {
    tabId: "tab-1",
    requestId: `request-${sequence}`,
    conversationId: `conversation-${sequence}`,
    mode: "auto",
    presetPrompt: "",
    conversationTitle: "测试对话",
    conversationCreatedAt: 1,
    messageId: `message-${sequence}`,
    messageCreatedAt: Date.now(),
    message: "检查磁盘",
    context: { tabId: "tab-1", serverId: "server-1", serverName: "demo", currentPath: "/srv" },
    history: [],
    ...overrides,
  };
}

function reset() {
  terminal.calls = [];
  terminal.execute = async () => ({
    stdout: "Filesystem 50%",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
  });
  model.requests = [];
  model.responses = [];
  model.urls = [];
}

test.after(async () => {
  await rm(storeDirectory, { recursive: true, force: true });
});

test("主循环执行命令后把结果交回模型，并在 finish_response 时结束", async () => {
  reset();
  model.responses.push(shell("df -h"), finish("磁盘使用率 50%，状态正常。"));
  const input = createInput();

  const result = await runtime.runAiChat(input, createSettings());

  assert.deepEqual(
    terminal.calls.map(call => call.command),
    ["df -h"],
  );
  assert.equal(terminal.calls[0].options.workingDirectory, "/srv");
  assert.equal(result.messages.at(-1).content, "磁盘使用率 50%，状态正常。");
  assert.deepEqual(
    result.commandCards.map(card => card.status),
    ["completed"],
  );

  const toolResult = model.requests[1].messages.find(message => message.role === "tool");
  assert.match(toolResult.content, /Filesystem 50%/);
  assert.match(model.requests[1].messages.at(-1).content, /不可信运行上下文/);

  // 主进程负责落盘：用户消息、最终回复、命令卡与命令记忆都已保存。
  const record = repository.getConversationRecord("server-1", input.conversationId);
  assert.equal(record.messages[0].content, "检查磁盘");
  assert.equal(record.messages.at(-1).content, "磁盘使用率 50%，状态正常。");
  assert.equal(record.commandCards.length, 1);
  const context = repository.getConversationRuntimeContext("server-1", input.conversationId);
  assert.equal(context.commands[0].command, "df -h");
  assert.ok(context.commands[0].executedAt > 0);
});

test("本地策略拒绝的命令以结构化反馈交回模型修正，不会被执行", async () => {
  reset();
  model.responses.push(shell("echo 'unfinished"), shell("uptime"), finish("负载正常。"));

  const result = await runtime.runAiChat(createInput(), createSettings());

  assert.deepEqual(
    terminal.calls.map(call => call.command),
    ["uptime"],
  );
  assert.deepEqual(
    result.commandCards.map(card => card.status),
    ["rejected", "completed"],
  );
  const feedback = model.requests[1].messages.find(
    message =>
      message.role === "tool" && message.content.includes("local_command_policy_rejection"),
  );
  assert.match(feedback.content, /未闭合引号/);
});

test("需要审批的命令暂停执行，批准后恢复同一轮并且审批只能使用一次", async () => {
  reset();
  model.responses.push(shell("systemctl restart nginx", "medium"));
  const input = createInput({ mode: "ask" });

  const paused = await runtime.runAiChat(input, createSettings());
  const card = paused.commandCards[0];
  assert.equal(card.status, "requires_approval");
  assert.ok(card.approvalId);
  assert.equal(terminal.calls.length, 0);

  await assert.rejects(
    () =>
      runtime.runApprovedAiCommand(
        {
          tabId: "tab-1",
          requestId: "resume-bad",
          conversationId: input.conversationId,
          command: "rm -rf /",
          approvalId: card.approvalId,
        },
        createSettings(),
      ),
    /不匹配/,
  );

  model.responses.push(finish("nginx 已重启。"));
  const resumed = await runtime.runApprovedAiCommand(
    {
      tabId: "tab-1",
      requestId: "resume-1",
      conversationId: input.conversationId,
      command: card.command,
      approvalId: card.approvalId,
    },
    createSettings(),
  );

  assert.deepEqual(
    terminal.calls.map(call => call.command),
    ["systemctl restart nginx"],
  );
  assert.equal(resumed.messages.at(-1).content, "nginx 已重启。");
  assert.equal(resumed.commandCards.find(item => item.id === card.id).status, "completed");
  await assert.rejects(
    () =>
      runtime.runApprovedAiCommand(
        {
          tabId: "tab-1",
          requestId: "resume-2",
          conversationId: input.conversationId,
          command: card.command,
          approvalId: card.approvalId,
        },
        createSettings(),
      ),
    /不存在或已过期/,
  );
});

test("用户拒绝审批后命令卡标记为已拒绝并持久化", async () => {
  reset();
  model.responses.push(shell("systemctl restart nginx", "medium"));
  const input = createInput({ mode: "ask" });
  const paused = await runtime.runAiChat(input, createSettings());
  const card = paused.commandCards[0];

  assert.equal(
    runtime.rejectAiCommandApproval({
      tabId: "tab-1",
      conversationId: input.conversationId,
      approvalId: card.approvalId,
    }),
    true,
  );
  assert.equal(terminal.calls.length, 0);
  const persisted = repository.getConversationRecord("server-1", input.conversationId)
    .commandCards[0];
  assert.equal(persisted.status, "rejected");
});

test("达到上下文预算时先压缩历史，再只发送摘要和新上下文段", async () => {
  reset();
  const history = Array.from({ length: 6 }, (_, index) => ({
    id: `h${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `第 ${index} 条历史 ${"内容".repeat(2_800)}`,
    createdAt: index + 1,
  }));
  model.responses.push(
    summary("用户在排查磁盘，已确认 /var 占用较高。"),
    finish("继续建议清理 /var/log。"),
  );
  const input = createInput({ history, message: "接下来怎么做", messageCreatedAt: 100 });

  const result = await runtime.runAiChat(input, createSettings({ contextTokenLimitK: 20 }));

  assert.equal(model.requests.length, 2);
  assert.equal(model.requests[0].tools, undefined);
  assert.match(model.requests[0].messages[0].content, /压缩 OrbitSSH 对话上下文/);
  const mainRequest = model.requests[1].messages;
  assert.ok(
    mainRequest.some(message => /不可信历史摘要[\s\S]*\/var 占用较高/.test(message.content)),
  );
  assert.equal(
    mainRequest.some(message => message.content.startsWith("第 0 条历史")),
    false,
  );
  assert.equal(result.messages.at(-1).content, "继续建议清理 /var/log。");
  assert.match(
    repository.getConversationRuntimeContext("server-1", input.conversationId).summary,
    /\/var 占用较高/,
  );
});

test("模型报告上下文窗口超限时压缩后重试一次", async () => {
  reset();
  model.responses.push(
    new Response('{"error":{"message":"This model\'s maximum context length is 8192 tokens"}}', {
      status: 400,
    }),
    summary("之前讨论了磁盘问题。"),
    finish("已基于摘要继续回答。"),
  );
  const input = createInput({
    history: [{ id: "h1", role: "user", content: "之前的问题", createdAt: 1 }],
    messageCreatedAt: 10,
  });

  const result = await runtime.runAiChat(input, createSettings());

  assert.equal(model.requests.length, 3);
  assert.match(model.requests[1].messages[0].content, /压缩 OrbitSSH 对话上下文/);
  assert.ok(model.requests[2].messages.some(message => /之前讨论了磁盘问题/.test(message.content)));
  assert.equal(result.messages.at(-1).content, "已基于摘要继续回答。");
});

function streamFinish(message, pieceSize = 4) {
  const args = JSON.stringify({ message });
  const encoder = new TextEncoder();
  const lines = [
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "finish-stream", type: "function", function: { name: "finish_response", arguments: "" } }] } }] })}\n\n`,
    ...args
      .match(new RegExp(`[\\s\\S]{1,${pieceSize}}`, "g"))
      .map(
        piece =>
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] } }] })}\n\n`,
      ),
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function createWebContents() {
  const events = [];
  return {
    events,
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => events.push({ channel, payload }),
    },
  };
}

test("最终答复随工具参数流式显示，先替换过渡文字再逐段追加", async () => {
  reset();
  const finalMessage = "磁盘使用率 50%，/var/log 占用最高，建议清理旧日志。";
  model.responses.push(() => streamFinish(finalMessage));
  const { events, webContents } = createWebContents();

  const result = await runtime.runAiChat(createInput(), createSettings(), webContents);

  const chunks = events
    .filter(event => event.channel === "ai:stream-chunk")
    .map(event => event.payload);
  assert.ok(chunks.length > 5, `流式片段数 ${chunks.length}`);
  assert.equal(chunks[0].replace, true);
  assert.ok(chunks.slice(1).every(chunk => !chunk.replace));
  assert.equal(
    chunks[0].chunk +
      chunks
        .slice(1)
        .map(chunk => chunk.chunk)
        .join(""),
    finalMessage,
  );
  assert.equal(result.messages.at(-1).content, finalMessage);
});

test("限流时按 Retry-After 退避重试，服务端繁忙最多尝试三次", async () => {
  reset();
  model.responses.push(
    new Response('{"error":{"message":"rate limited"}}', {
      status: 429,
      headers: { "Retry-After": "0" },
    }),
    new Response('{"error":{"message":"overloaded"}}', {
      status: 503,
      headers: { "Retry-After": "0" },
    }),
    finish("第三次请求成功。"),
  );

  const result = await runtime.runAiChat(createInput(), createSettings());

  assert.equal(model.requests.length, 3);
  assert.equal(result.messages.at(-1).content, "第三次请求成功。");
});

test("API Key 无效时不重试，并直接说明原因", async () => {
  reset();
  model.responses.push(new Response('{"error":{"message":"invalid api key"}}', { status: 401 }));

  const result = await runtime.runAiChat(createInput(), createSettings());

  assert.equal(model.requests.length, 1);
  assert.match(result.messages.at(-1).content, /API Key 无效/);
  assert.match(result.messages.at(-1).content, /invalid api key/);
});

test("DeepSeek 直接使用 Chat Completions，其他服务探测一次后记住结果", async () => {
  reset();
  model.responses.push(finish("ok"));
  await runtime.runAiChat(
    createInput(),
    createSettings({ provider: "deepseek", baseUrl: "http://deepseek.local/v1" }),
  );
  assert.deepEqual(model.urls, ["http://deepseek.local/v1/chat/completions"]);

  reset();
  model.responses.push(finish("ok"), finish("ok"));
  const settings = createSettings({ provider: "other", baseUrl: "http://gateway.local/v1" });
  await runtime.runAiChat(createInput(), settings);
  await runtime.runAiChat(createInput(), settings);
  assert.deepEqual(model.urls, [
    "http://gateway.local/v1/responses",
    "http://gateway.local/v1/chat/completions",
    "http://gateway.local/v1/chat/completions",
  ]);
});

test("界面新增的 DeepSeek 与 GLM 模型按 Base URL 识别，直接使用 Chat Completions", async () => {
  for (const baseUrl of ["https://api.deepseek.com/v1", "https://open.bigmodel.cn/api/paas/v4"]) {
    reset();
    model.responses.push(finish("ok"));
    await runtime.runAiChat(createInput(), createSettings({ provider: "other", baseUrl }));
    assert.deepEqual(model.urls, [`${baseUrl}/chat/completions`]);
  }
});
