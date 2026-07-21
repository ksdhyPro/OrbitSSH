import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSseStream,
  parseAttachmentReadToolCalls,
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

test("SSE 实时转发推理字段", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"先检查 "}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning":"当前状态"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"完成"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  const streamed = [];
  const result = await collectSseStream(body, text => streamed.push(text));

  assert.equal(result.contentText, "先检查 当前状态完成");
  assert.deepEqual(streamed, ["先检查 ", "当前状态", "完成"]);
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

test("解析大型附件分段读取工具并限制单段大小", () => {
  const reads = parseAttachmentReadToolCalls([
    {
      type: "function",
      function: {
        name: "read_attachment_chunk",
        arguments: JSON.stringify({
          attachment_id: "attachment-log",
          offset: 1024,
          max_bytes: 100_000,
        }),
      },
    },
  ]);
  assert.deepEqual(reads, [{
    attachmentId: "attachment-log",
    offset: 1024,
    maxBytes: 32 * 1024,
  }]);
  assert.deepEqual(parseAttachmentReadToolCalls([{
    type: "function",
    function: {
      name: "read_attachment_chunk",
      arguments: '{"attachment_id":"attachment-log","offset":-1,"max_bytes":10}',
    },
  }]), []);
});
