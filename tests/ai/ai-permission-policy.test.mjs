import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAiCommandPermission,
  resolveSavedServerCommandPermission,
} from "../../dist-electron/main/ai/ai-permission-policy.js";
import { evaluateAiCommand } from "../../dist-electron/main/ai/command-policy.js";

function decide(mode, command, risk = "medium", approvalGranted = false) {
  return resolveAiCommandPermission(
    mode,
    risk,
    evaluateAiCommand(command),
    approvalGranted,
  ).decision;
}

test("请求批准模式要求确认所有格式有效的命令", () => {
  assert.equal(decide("ask", "pwd", "low"), "requires_approval");
  assert.equal(decide("ask", "mkdir -p /tmp/demo"), "requires_approval");
});

test("自主执行模式放行常规操作，仅拦截高风险和敏感操作", () => {
  assert.equal(decide("auto", "pwd", "low"), "execute");
  assert.equal(decide("auto", "echo ready > /tmp/status"), "execute");
  assert.equal(decide("auto", "npm install"), "execute");
  assert.equal(decide("auto", "systemctl restart nginx"), "execute");
  assert.equal(decide("auto", "rm -rf /tmp/demo", "high"), "requires_approval");
  assert.equal(decide("auto", "docker rm api"), "requires_approval");
  assert.equal(decide("auto", "cat ~/.ssh/id_rsa"), "requires_approval");
});

test("完全访问模式不审批高风险或敏感命令", () => {
  assert.equal(decide("full_access", "rm -rf /tmp/demo", "high"), "execute");
  assert.equal(decide("full_access", "docker rm api", "high"), "execute");
  assert.equal(decide("full_access", "cat ~/.ssh/id_rsa", "high"), "execute");
});

test("任何权限档位都不能执行格式无效的命令", () => {
  for (const mode of ["ask", "auto", "full_access"]) {
    assert.equal(decide(mode, "echo 'unfinished"), "deny");
    assert.equal(decide(mode, "echo\0value"), "deny");
  }
});

test("用户批准可以跳过审批，但不能绕过格式拒绝", () => {
  assert.equal(decide("auto", "rm -rf /tmp/demo", "high", true), "execute");
  assert.equal(decide("ask", "echo 'unfinished", "high", true), "deny");
});

test("跨服务器命令在所有模式下都必须逐次明确批准", () => {
  const policy = evaluateAiCommand("uptime");
  for (const mode of ["ask", "auto", "full_access"]) {
    assert.equal(
      resolveSavedServerCommandPermission(true, mode, "low", policy, false).decision,
      "requires_approval",
    );
    assert.equal(
      resolveSavedServerCommandPermission(true, mode, "low", policy, true).decision,
      "execute",
    );
  }
});

test("关闭跨服务器开关后任何权限档位和历史审批都不能绕过", () => {
  const policy = evaluateAiCommand("uptime");
  for (const mode of ["ask", "auto", "full_access"]) {
    const permission = resolveSavedServerCommandPermission(
      false,
      mode,
      "low",
      policy,
      true,
    );
    assert.equal(permission.decision, "deny");
    assert.match(permission.reason, /全局 AI 设置/);
  }
});
