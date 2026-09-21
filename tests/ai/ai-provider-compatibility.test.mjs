import assert from "node:assert/strict";
import test from "node:test";

import {
  requestAiJsonWithCompatibilityFallback,
} from "../../dist-electron/main/ai/ai-provider-compatibility.js";

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
