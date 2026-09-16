import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectSseStream,
  evaluateAssistantTurnProtocol,
  parseLongCommandProgressToolCalls,
  parseRunLongShellToolCalls,
  parseRunShellToolCalls,
  parseSavedServerToolCalls,
} from "../../dist-electron/main/ai/ai-response-parser.js";

test("承诺执行但未调用工具的回复不会被判定为完成", () => {
  const result = evaluateAssistantTurnProtocol(
    "好的，我来帮你检查 nginx 配置。",
    [],
  );

  assert.equal(result.outcome, "protocol_error");
  assert.equal(result.retryable, true);
});

test("finish_response 明确标记 Agent 正常完成", () => {
  const result = evaluateAssistantTurnProtocol("", [{
    id: "finish-1",
    type: "function",
    function: {
      name: "finish_response",
      arguments: JSON.stringify({ message: "nginx 配置检查完成。" }),
    },
  }]);

  assert.equal(result.outcome, "finish");
  assert.equal(result.retryable, false);
  assert.equal(result.finalReply, "nginx 配置检查完成。");
});

test("仅接受参数有效的已知工具动作", () => {
  const valid = evaluateAssistantTurnProtocol("准备检查。", [{
    id: "command-1",
    type: "function",
    function: {
      name: "run_shell_command",
      arguments: JSON.stringify({
        command: "nginx -T",
        reason: "读取 nginx 完整配置",
        risk: "low",
      }),
    },
  }]);
  const unknown = evaluateAssistantTurnProtocol("准备检查。", [{
    id: "unknown-1",
    type: "function",
    function: { name: "inspect_nginx", arguments: "{}" },
  }]);

  assert.equal(valid.outcome, "tool_call");
  assert.equal(valid.retryable, false);
  assert.equal(unknown.outcome, "protocol_error");
  assert.equal(unknown.retryable, true);
});

test("长命令和进度汇报使用独立工具协议", () => {
  const longCall = [{
    id: "long-1",
    type: "function",
    function: {
      name: "run_long_shell_command",
      arguments: JSON.stringify({
        command: "docker pull nginx:latest",
        reason: "拉取镜像",
        risk: "high",
      }),
    },
  }];
  const progressCall = [{
    id: "progress-1",
    type: "function",
    function: {
      name: "report_long_command_progress",
      arguments: JSON.stringify({ message: "镜像仍在拉取中。" }),
    },
  }];

  assert.equal(evaluateAssistantTurnProtocol("", longCall).outcome, "tool_call");
  assert.equal(parseRunLongShellToolCalls(longCall)[0].command, "docker pull nginx:latest");
  assert.equal(
    evaluateAssistantTurnProtocol("", progressCall, "long_command_running").outcome,
    "tool_call",
  );
  assert.equal(
    parseLongCommandProgressToolCalls(progressCall)[0].message,
    "镜像仍在拉取中。",
  );
  assert.equal(
    evaluateAssistantTurnProtocol("", [{
      type: "function",
      function: {
        name: "finish_response",
        arguments: JSON.stringify({ message: "已经完成" }),
      },
    }], "long_command_running").outcome,
    "protocol_error",
  );
});

test("SSE 支持无空格 data: 并累积工具参数分片", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data:{"choices":[{"delta":{"content":"开始"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"run_shell_command","arguments":"{\\"command\\":\\"df"}}]}}]}\n\n',
    'data:{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" -h\\",\\"reason\\":\\"检查磁盘\\",\\"risk\\":\\"low\\"}"}}]}}]}\n\n',
    'data:{"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"total_tokens":128}}\n\n',
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
  assert.deepEqual(result.usage, {
    promptTokens: 120,
    completionTokens: 8,
    totalTokens: 128,
    source: "provider",
  });
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

test("已保存服务器工具接受三档权限所需的风险级别", () => {
  const commands = parseSavedServerToolCalls([{
    type: "function",
    function: {
      name: "run_saved_server_command",
      arguments: JSON.stringify({
        serverName: "backup",
        command: "systemctl restart nginx",
        reason: "重启备机服务",
        risk: "medium",
      }),
    },
  }]);

  assert.equal(commands[0].serverName, "backup");
  assert.equal(commands[0].risk, "medium");
});

test("AI 请求日志明确记录 Token 统计来源和用量", async () => {
  const providerSource = await readFile(
    new URL("../../src/main/ai/ai-provider.ts", import.meta.url),
    "utf8",
  );

  assert.match(providerSource, /AI Token 用量：接口统计/);
  assert.match(providerSource, /AI Token 用量：本地估算/);
  assert.match(providerSource, /promptTokens: resolvedUsage\.promptTokens/);
  assert.match(providerSource, /totalTokens: resolvedUsage\.totalTokens/);
});
