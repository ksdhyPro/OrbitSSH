import assert from "node:assert/strict";
import test from "node:test";

import {
  runLongCommandMonitor,
} from "../../dist-electron/main/ai/ai-long-command.js";
import {
  executeLocalTerminalCommand,
} from "../../dist-electron/main/ssh/terminal-command.js";

const completedResult = {
  stdout: "done",
  stderr: "",
  exitCode: 0,
  timedOut: false,
  durationMs: 5,
};

function createOptions(overrides = {}) {
  return {
    toolCallId: "long-call-1",
    command: "docker pull nginx:latest",
    reason: "拉取镜像",
    risk: "high",
    signal: new AbortController().signal,
    reportIntervalMs: 10,
    onProgress: async () => undefined,
    execute: async () => completedResult,
    ...overrides,
  };
}

test("长命令提前完成时不会等待汇报周期", async () => {
  let reportCount = 0;
  const startedAt = Date.now();
  const result = await runLongCommandMonitor(createOptions({
    onProgress: async () => {
      reportCount += 1;
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(reportCount, 0);
  assert.ok(Date.now() - startedAt < 100);
});

test("长命令按周期汇报新增输出且只启动一次", async () => {
  let executeCount = 0;
  const reports = [];
  const result = await runLongCommandMonitor(createOptions({
    execute: onOutput => new Promise(resolve => {
      executeCount += 1;
      onOutput("stderr", "Downloading layer\n");
      setTimeout(() => resolve(completedResult), 25);
    }),
    onProgress: async progress => {
      reports.push(progress);
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(executeCount, 1);
  assert.ok(reports.length >= 1);
  assert.equal(reports[0].outputChanged, true);
  assert.match(reports[0].stderrDelta, /Downloading layer/);
});

test("用户取消会终止等待并返回 AbortError", async () => {
  const controller = new AbortController();
  const execution = runLongCommandMonitor(createOptions({
    signal: controller.signal,
    execute: () => new Promise((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  }));

  controller.abort();
  await assert.rejects(execution, error => error?.name === "AbortError");
});

test("本地长命令可以流式读取 stdout 和 stderr", async () => {
  const chunks = [];
  const executable = `"${process.execPath}"`;
  const command = `${executable} -e "process.stdout.write('out'); process.stderr.write('err')"`;
  const result = await executeLocalTerminalCommand(
    process.cwd(),
    command,
    5_000,
    undefined,
    (stream, text) => chunks.push({ stream, text }),
  );

  assert.equal(result.exitCode, 0);
  assert.ok(chunks.some(item => item.stream === "stdout" && item.text.includes("out")));
  assert.ok(chunks.some(item => item.stream === "stderr" && item.text.includes("err")));
});
