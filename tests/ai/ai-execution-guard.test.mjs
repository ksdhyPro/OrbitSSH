import assert from "node:assert/strict";
import test from "node:test";

import { shouldFinalizeAfterAiCommand } from "../../dist-electron/main/ai/ai-execution-guard.js";

const success = {
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  timedOut: false,
  durationMs: 100,
};

test("成功的写入或状态变更命令结束本轮工具执行", () => {
  assert.equal(
    shouldFinalizeAfterAiCommand(
      {
        risk: "high",
        policy: { decision: "requires_approval", reason: "需要批准" },
      },
      success,
    ),
    true,
  );
  assert.equal(
    shouldFinalizeAfterAiCommand(
      {
        risk: "medium",
        policy: { decision: "allow_full", reason: "完全访问模式" },
      },
      success,
    ),
    true,
  );
});

test("成功的只读命令仍允许继续诊断，失败命令交给现有错误流程", () => {
  assert.equal(
    shouldFinalizeAfterAiCommand(
      {
        risk: "low",
        policy: { decision: "allow_readonly", reason: "只读白名单" },
      },
      success,
    ),
    false,
  );
  assert.equal(
    shouldFinalizeAfterAiCommand(
      {
        risk: "high",
        policy: { decision: "requires_approval", reason: "需要批准" },
      },
      { ...success, exitCode: 1 },
    ),
    false,
  );
});
