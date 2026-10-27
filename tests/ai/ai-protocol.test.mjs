import assert from "node:assert/strict";
import { mock, test } from "node:test";

const protocols = new Map();
const unsupported = new Set();
const logs = [];
const moduleUrl = path => new URL(`../../dist-electron/main/${path}`, import.meta.url).href;

// 仅隔离 Electron 存储与日志，协议选择、参数回退均执行真实实现。
mock.module(moduleUrl("logger.js"), {
  namedExports: { writeAppLog: entry => logs.push(entry) },
});
mock.module(moduleUrl("storage/ai-protocol-store.js"), {
  namedExports: {
    getRememberedProtocol: key => protocols.get(key),
    rememberProtocol: (key, value) => protocols.set(key, value),
    isToolChoiceUnsupported: (key, protocol) => unsupported.has(`${key}:${protocol}`),
    rememberToolChoiceUnsupported: (key, protocol) => unsupported.add(`${key}:${protocol}`),
  },
});
const { requestPreferredApi } = await import(moduleUrl("ai/ai-protocol.js"));

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "test-secret",
  model: "deepseek-flash",
};

async function request(provider = "deepseek") {
  return requestPreferredApi(
    { ...config, provider },
    { model: config.model, input: "hello", tool_choice: "required", stream: true },
    { model: config.model, messages: [], tool_choice: "required", stream: true },
    new AbortController().signal,
    provider,
    "test-tab",
  );
}

test.beforeEach(() => {
  protocols.clear();
  unsupported.clear();
  logs.length = 0;
});
test.afterEach(() => mock.restoreAll());

test("DeepSeek 优先使用 Responses 与 auto，不关闭思考模式", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ ok: true });
  });
  const result = await request();
  assert.equal(result.protocol, "responses");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/responses");
  assert.equal(calls[0].body.tool_choice, "auto");
  assert.equal("reasoning" in calls[0].body, false);
  assert.equal("thinking" in calls[0].body, false);
});

test("未知兼容服务的参数回退被记住，后续请求不重复触发 400", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return body.tool_choice
      ? Response.json(
          { error: { message: "Thinking mode does not support this tool_choice" } },
          { status: 400 },
        )
      : Response.json({ ok: true });
  });
  assert.equal((await request("other")).response.status, 200);
  assert.equal((await request("other")).response.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.tool_choice, "required");
  assert.equal("tool_choice" in calls[1].body, false);
  assert.equal("tool_choice" in calls[2].body, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].data.parameter, "tool_choice");
});

test("Responses 不支持时回退 Chat，随后直接使用记住的协议", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return url.endsWith("/responses")
      ? Response.json({ error: { message: "Unknown endpoint /responses" } }, { status: 400 })
      : Response.json({ ok: true });
  });
  assert.equal((await request()).protocol, "chat_completions");
  assert.equal((await request()).protocol, "chat_completions");
  assert.deepEqual(
    calls.map(call => call.url),
    [
      "https://api.deepseek.com/responses",
      "https://api.deepseek.com/chat/completions",
      "https://api.deepseek.com/chat/completions",
    ],
  );
  assert.ok(calls.every(call => call.body.tool_choice === "auto"));
});

test("模型错误不切换协议也不写入协议缓存", async () => {
  let requests = 0;
  mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ error: { message: "Invalid model" } }, { status: 400 });
  });
  const result = await request();
  assert.equal(result.response.status, 400);
  assert.equal(result.protocol, "responses");
  assert.equal(requests, 1);
  assert.equal(protocols.size, 0);
});
