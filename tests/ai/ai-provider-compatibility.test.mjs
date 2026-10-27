import assert from "node:assert/strict";
import test from "node:test";

import { requestAiJsonWithCompatibilityFallback } from "../../dist-electron/main/ai/ai-provider-compatibility.js";

function createJsonResponse(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("接口不支持 tool_choice 时移除参数并重试", async () => {
  const requestBodies = [];
  const responses = [
    createJsonResponse(400, { error: { message: "Unknown parameter: tool_choice" } }),
    createJsonResponse(200, { ok: true }),
  ];
  const body = {
    model: "test-model",
    tool_choice: "required",
    tools: [],
  };

  const result = await requestAiJsonWithCompatibilityFallback(
    "http://127.0.0.1/v1/responses",
    { Authorization: "Bearer test" },
    body,
    undefined,
    false,
    async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      return responses.shift();
    },
  );

  assert.equal(result.response.status, 200);
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].tool_choice, "required");
  assert.equal("tool_choice" in requestBodies[1], false);
  assert.equal("tool_choice" in body, false);
});

test("普通请求错误不会触发兼容参数回退", async () => {
  let requestCount = 0;
  const body = {
    model: "test-model",
    tool_choice: "required",
    tools: [],
  };

  const result = await requestAiJsonWithCompatibilityFallback(
    "http://127.0.0.1/v1/responses",
    {},
    body,
    undefined,
    false,
    async () => {
      requestCount += 1;
      return createJsonResponse(400, { error: { message: "Invalid model" } });
    },
  );

  assert.equal(result.response.status, 400);
  assert.equal(requestCount, 1);
  assert.equal(body.tool_choice, "required");
});

test("兼容接口可依次回退 stream_options 和 tool_choice", async () => {
  const requestBodies = [];
  const responses = [
    createJsonResponse(400, { error: { message: "stream_options is not supported" } }),
    createJsonResponse(422, { error: { message: "tool_choice is not supported" } }),
    createJsonResponse(200, { ok: true }),
  ];
  const body = {
    model: "test-model",
    stream: true,
    stream_options: { include_usage: true },
    tool_choice: "required",
    tools: [],
  };

  const result = await requestAiJsonWithCompatibilityFallback(
    "http://127.0.0.1/v1/chat/completions",
    {},
    body,
    undefined,
    true,
    async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      return responses.shift();
    },
  );

  assert.equal(result.response.status, 200);
  assert.equal(requestBodies.length, 3);
  assert.equal("stream_options" in requestBodies[1], false);
  assert.equal(requestBodies[1].tool_choice, "required");
  assert.equal("tool_choice" in requestBodies[2], false);
});

test("DeepSeek 思考模式拒绝强制工具选择时保留工具并回退", async () => {
  const requests = [];
  const fallbacks = [];
  const body = { model: "deepseek-flash", tools: [{ type: "function" }], tool_choice: "required" };
  const result = await requestAiJsonWithCompatibilityFallback(
    "https://api.deepseek.com/responses",
    {},
    body,
    undefined,
    false,
    async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return requests.length === 1
        ? createJsonResponse(400, {
            error: { message: "Thinking mode does not support this tool_choice" },
          })
        : createJsonResponse(200);
    },
    parameter => fallbacks.push(parameter),
  );
  assert.equal(result.response.status, 200);
  assert.equal(requests.length, 2);
  assert.equal("tool_choice" in requests[1], false);
  assert.deepEqual(requests[1].tools, body.tools);
  assert.deepEqual(fallbacks, ["tool_choice"]);
});

test("结构化错误的 param 字段可定位不支持的参数", async () => {
  let requests = 0;
  const result = await requestAiJsonWithCompatibilityFallback(
    "https://example.com/responses",
    {},
    { tool_choice: "required" },
    undefined,
    false,
    async () =>
      ++requests === 1
        ? createJsonResponse(422, {
            error: { message: "This value is not supported", param: "tool_choice" },
          })
        : createJsonResponse(200),
  );
  assert.equal(result.response.status, 200);
  assert.equal(requests, 2);
});

test("认证、限流、服务异常和无关参数错误不触发兼容回退", async () => {
  for (const [status, error] of [
    [401, { message: "tool_choice not supported" }],
    [429, { message: "tool_choice not supported" }],
    [500, { message: "tool_choice not supported" }],
    [400, { message: "Unknown parameter: model", param: "model" }],
    [400, { message: "Unknown parameter: tool_choice_extra" }],
  ]) {
    let requests = 0;
    const result = await requestAiJsonWithCompatibilityFallback(
      "https://example.com/responses",
      {},
      { tool_choice: "required" },
      undefined,
      false,
      async () => {
        requests++;
        return createJsonResponse(status, { error });
      },
    );
    assert.equal(result.response.status, status);
    assert.equal(requests, 1);
  }
});

test("两个参数回退后仍失败时保留最终响应且不无限重试", async () => {
  let requests = 0;
  const result = await requestAiJsonWithCompatibilityFallback(
    "https://example.com/chat/completions",
    {},
    { tool_choice: "required", stream_options: { include_usage: true } },
    undefined,
    true,
    async () => {
      requests++;
      return createJsonResponse(400, {
        error: {
          message:
            requests === 1
              ? "tool_choice does not support this value"
              : requests === 2
                ? "stream_options is unsupported"
                : "Invalid model",
        },
      });
    },
  );
  assert.equal(requests, 3);
  assert.equal(result.response.status, 400);
  assert.match(result.responseText, /Invalid model/);
});
