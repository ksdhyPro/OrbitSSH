import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSseStream,
  parseRunShellToolCalls,
} from "../../dist-electron/main/ai/ai-response-parser.js";

test("SSE 支持无空格 data: 并累积工具参数分片", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data:{"choices":[{"delta":{"content":"开始"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"run_shell_command","arguments":"{\\"command\\":\\"df"}}]}}]}\n\n',
    'data:{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" -h\\",\\"reason\\":\\"检查磁盘\\",\\"risk\\":\\"low\\"}"}}]}}]}\n\n',
    "data:[DONE]\n\n",
  ];
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  const streamed = [];
  const result = await collectSseStream(body, text => streamed.push(text));
  assert.equal(result.contentText, "开始");
  assert.deepEqual(streamed, ["开始"]);
  assert.equal(result.toolCalls[0].name, "run_shell_command");
  assert.equal(JSON.parse(result.toolCalls[0].arguments).command, "df -h");
});

test("只解析 run_shell_command 工具", () => {
  const unknown = parseRunShellToolCalls([
    { type: "function", function: { name: "delete_files", arguments: '{"command":"rm -rf /"}' } },
  ]);
  assert.deepEqual(unknown, []);

  const allowed = parseRunShellToolCalls([
    { type: "function", function: { name: "run_shell_command", arguments: '{"command":"pwd","reason":"检查路径","risk":"low"}' } },
  ]);
  assert.equal(allowed[0].command, "pwd");
});
