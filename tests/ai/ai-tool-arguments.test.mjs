import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAssistantTurnProtocol,
  parseRunLongShellToolCalls,
  parseRunShellToolCalls,
  parseSavedServerToolCalls,
} from "../../dist-electron/main/ai/ai-response-parser.js";

function shellCall(args, name = "run_shell_command") {
  return [{ id: "call-1", type: "function", function: { name, arguments: args } }];
}

test("工具参数不是合法 JSON 时不猜测命令，交由协议重试", () => {
  const truncated = [
    `{"command": "find / -name '*.log' -delete", "reason": "清理`,
    `{"command": "grep "error" /var/log/syslog"}`,
    "command=rm -rf /tmp/demo",
    "",
  ];
  for (const args of truncated) {
    const toolCalls = shellCall(args);
    assert.deepEqual(parseRunShellToolCalls(toolCalls), [], args);
    assert.deepEqual(
      parseRunLongShellToolCalls(shellCall(args, "run_long_shell_command")),
      [],
      args,
    );
    const protocol = evaluateAssistantTurnProtocol("", toolCalls);
    assert.equal(protocol.outcome, "protocol_error", args);
    assert.equal(protocol.retryable, true, args);
  }
});

test("一次工具调用给出多条命令时整体视为无效，不静默丢弃其余命令", () => {
  const args = JSON.stringify({
    commands: ["systemctl stop nginx", "rm -rf /var/www/html"],
    reason: "清理站点",
    risk: "high",
  });
  assert.deepEqual(parseRunShellToolCalls(shellCall(args)), []);
  assert.equal(evaluateAssistantTurnProtocol("", shellCall(args)).outcome, "protocol_error");
});

test("兼容二次编码的合法 JSON 参数和单条命令数组", () => {
  const doubleEncoded = JSON.stringify(
    JSON.stringify({ command: "uptime", reason: "查看负载", risk: "low" }),
  );
  assert.equal(parseRunShellToolCalls(shellCall(doubleEncoded))[0].command, "uptime");

  const singleArray = JSON.stringify({ commands: ["df -h"], reason: "查看磁盘", risk: "low" });
  assert.equal(parseRunShellToolCalls(shellCall(singleArray))[0].command, "df -h");
});

test("跨服务器和完成动作的参数同样必须是合法 JSON", () => {
  assert.deepEqual(
    parseSavedServerToolCalls(
      shellCall(`{"serverName": "db", "command": "uptime"`, "run_saved_server_command"),
    ),
    [],
  );
  assert.equal(
    evaluateAssistantTurnProtocol("", shellCall(`{"message": "检查完成`, "finish_response"))
      .outcome,
    "protocol_error",
  );
});
