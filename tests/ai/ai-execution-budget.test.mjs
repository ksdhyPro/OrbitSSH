import assert from "node:assert/strict";
import test from "node:test";

import { getAiExecutionStopReason } from "../../dist-electron/main/ai/ai-execution-budget.js";

function createExecutedCommand(index, overrides = {}) {
  return {
    toolCallId: `call-${index}`,
    toolName: "run_shell_command",
    command: `check-${index}`,
    reason: "检查状态",
    risk: "low",
    result: {
      stdout: `result-${index}`,
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
    },
    ...overrides,
  };
}

test("单轮执行达到十二条命令后停止", () => {
  const executed = Array.from({ length: 12 }, (_, index) =>
    createExecutedCommand(index),
  );
  assert.match(getAiExecutionStopReason(executed, Date.now()), /12 条命令/);
});

test("不同命令连续返回相同结果时会识别为无进展", () => {
  const repeatedResult = {
    stdout: "same",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
  };
  const executed = Array.from({ length: 4 }, (_, index) =>
    createExecutedCommand(index, { result: repeatedResult }),
  );
  assert.match(getAiExecutionStopReason(executed, Date.now()), /未获得有效新结果/);
});
