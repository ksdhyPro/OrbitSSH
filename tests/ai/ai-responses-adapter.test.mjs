import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResponsesInput,
  buildResponsesTools,
  collectResponsesSseStream,
  isResponsesApiUnsupported,
  parseResponsesPayload,
} from "../../dist-electron/main/ai/ai-responses-adapter.js";

test("Chat 消息和工具可转换为 Responses API 格式", () => {
  const input = buildResponsesInput([
    { role: "system", content: "系统规则" },
    {
      role: "assistant",
      content: "检查磁盘",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "run_shell_command", arguments: '{"command":"df -h"}' },
      }],
    },
    { role: "tool", tool_call_id: "call-1", content: "磁盘正常" },
  ]);
  assert.deepEqual(input, [
    { role: "system", content: "系统规则" },
    { role: "assistant", content: "检查磁盘" },
    {
      type: "function_call",
      call_id: "call-1",
      name: "run_shell_command",
      arguments: '{"command":"df -h"}',
    },
    { type: "function_call_output", call_id: "call-1", output: "磁盘正常" },
  ]);

  assert.deepEqual(buildResponsesTools([{
    type: "function",
    function: {
      name: "run_shell_command",
      description: "执行命令",
      parameters: { type: "object" },
      strict: true,
    },
  }]), [{
    type: "function",
    name: "run_shell_command",
    description: "执行命令",
    parameters: { type: "object" },
    strict: true,
  }]);
});

test("Responses 非流式结果可解析文本、工具调用和 usage", () => {
  const parsed = parseResponsesPayload({
    output: [
      { type: "message", content: [{ type: "output_text", text: "开始检查" }] },
      {
        type: "function_call",
        call_id: "call-2",
        name: "run_shell_command",
        arguments: '{"command":"uptime","reason":"检查负载","risk":"low"}',
      },
    ],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  });

  assert.equal(parsed.contentText, "开始检查");
  assert.equal(parsed.toolCalls[0].id, "call-2");
  assert.equal(parsed.toolCalls[0].function.name, "run_shell_command");
  assert.deepEqual(parsed.usage, {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    source: "provider",
  });
});

test("Responses 流式事件可聚合文本、函数参数和 usage", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"type":"response.output_text.delta","delta":"正在"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"检查"}\n\n',
    'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","call_id":"call-3","name":"run_shell_command","arguments":""}}\n\n',
    'data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{\\"command\\":\\"pwd\\"}"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":80,"output_tokens":10,"total_tokens":90}}}\n\n',
  ];
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  const streamed = [];
  const parsed = await collectResponsesSseStream(body, value => streamed.push(value));

  assert.equal(parsed.contentText, "正在检查");
  assert.deepEqual(streamed, ["正在", "检查"]);
  assert.deepEqual(parsed.toolCalls[0], {
    id: "call-3",
    name: "run_shell_command",
    arguments: '{"command":"pwd"}',
  });
  assert.equal(parsed.usage.totalTokens, 90);
});

test("只有明确不支持 Responses API 时才允许降级", () => {
  assert.equal(isResponsesApiUnsupported(404, "not found"), true);
  assert.equal(
    isResponsesApiUnsupported(400, "This model is not supported in the v1/responses endpoint"),
    true,
  );
  assert.equal(isResponsesApiUnsupported(401, "invalid api key"), false);
  assert.equal(isResponsesApiUnsupported(429, "rate limit"), false);
  assert.equal(isResponsesApiUnsupported(500, "server error"), false);
});
