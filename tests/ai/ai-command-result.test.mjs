import assert from "node:assert/strict";
import test from "node:test";

import {
  getAiCommandResultError,
  getAiCommandResultStatus,
} from "../../dist-electron/main/ai/ai-command-result.js";

function result(exitCode, timedOut = false) {
  return { stdout: "", stderr: "", exitCode, timedOut, durationMs: 1 };
}

test("命令卡终态严格跟随退出码和超时状态", () => {
  assert.equal(getAiCommandResultStatus(result(0)), "completed");
  assert.equal(getAiCommandResultStatus(result(1)), "failed");
  assert.equal(getAiCommandResultStatus(result(null, true)), "failed");
  assert.equal(getAiCommandResultError(result(0)), undefined);
  assert.match(getAiCommandResultError(result(1)), /退出码 1/);
  assert.match(getAiCommandResultError(result(null, true)), /超时/);
});
