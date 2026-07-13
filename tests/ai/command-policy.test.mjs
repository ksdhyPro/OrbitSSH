import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAiCommand,
  isReadonlyAllowedCommand,
} from "../../dist-electron/main/ai/command-policy.js";

test("只读白名单与 Full 未知命令使用不同决策", () => {
  assert.equal(evaluateAiCommand("df -h").decision, "allow_readonly");
  assert.equal(isReadonlyAllowedCommand("df -h"), true);
  assert.equal(evaluateAiCommand("custom-health-check").decision, "allow_full");
  assert.equal(isReadonlyAllowedCommand("custom-health-check"), false);
});

test("高风险命令及常见包装形式必须审批", () => {
  const commands = [
    "rm -rf /tmp/demo",
    "'/bin/rm' -rf /tmp/demo",
    "env TEST=1 rm -rf /tmp/demo",
    "command rm -rf /tmp/demo",
    "nice -n 5 rm -rf /tmp/demo",
    "nohup rm -rf /tmp/demo",
    "nice --adjustment=5 /bin/rm -rf /tmp/demo",
    "nohup -- /bin/rm -rf /tmp/demo",
    "/usr/bin/python3 cleanup.py",
    "pwd\nrm -rf /tmp/demo",
    "curl -X DELETE https://example.com/resource",
    "docker system prune -af",
    "redis-cli FLUSHALL",
    "systemctl mask nginx",
    "python3 cleanup.py",
  ];
  for (const command of commands) {
    assert.equal(
      evaluateAiCommand(command).decision,
      "requires_approval",
      command,
    );
  }
});

test("非法或无法安全展示的命令直接拒绝", () => {
  assert.equal(evaluateAiCommand("echo 'unfinished").decision, "deny");
  assert.equal(evaluateAiCommand(`echo ${"x".repeat(4_100)}`).decision, "deny");
  assert.equal(evaluateAiCommand("echo\0value").decision, "deny");
});

test("复合只读命令保留自动执行能力", () => {
  assert.equal(
    evaluateAiCommand("pwd && df -h; free -h").decision,
    "allow_readonly",
  );
  assert.equal(
    evaluateAiCommand("pwd; rm -rf /tmp/demo").decision,
    "requires_approval",
  );
});
