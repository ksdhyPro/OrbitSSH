import assert from "node:assert/strict";
import test from "node:test";

import { parseCodexOutput } from "../../dist-electron/main/ai/codex-cli-provider.js";

test("Codex CLI 可以返回已保存服务器动作", () => {
  const parsed = parseCodexOutput(JSON.stringify({
    reply: "查看备机状态",
    commands: [],
    savedServerCommands: [{
      serverName: "backup",
      command: "systemctl restart nginx",
      reason: "重启服务",
      risk: "medium",
    }],
  }));

  assert.equal(parsed.commands.length, 0);
  assert.equal(parsed.savedServerCommands[0].serverName, "backup");
  assert.equal(parsed.savedServerCommands[0].command, "systemctl restart nginx");
  assert.equal(parsed.savedServerCommands[0].risk, "medium");
});

test("Codex CLI 单轮不能同时返回两个服务器动作", () => {
  assert.throws(() => parseCodexOutput(JSON.stringify({
    reply: "检查状态",
    commands: [{ command: "pwd", reason: "查看目录", risk: "low" }],
    savedServerCommands: [{
      serverName: "backup",
      command: "uptime",
      reason: "查看运行时间",
      risk: "low",
    }],
  })), /多个工具动作/);
});
