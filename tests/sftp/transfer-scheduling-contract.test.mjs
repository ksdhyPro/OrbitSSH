import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 传输队列与任务管理器依赖 Electron 设置存储，无法在纯 Node 环境加载，暂以源码契约校验。
const readSource = relativePath =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("提高并发数后立即补满空闲传输槽位", async () => {
  const source = await readSource("src/main/sftp/sftp-transfer-common.ts");

  assert.match(source, /while \(activeTransferCount < getMaxConcurrentTransferTasks\(\)\)/);
  assert.match(
    source,
    /export function setMaxConcurrentTransferTasks[\s\S]*?runNextQueuedTransfer\(\)/,
  );
});

test("调度器只从最早的未完成批次分配任务", async () => {
  const source = await readSource("src/main/sftp/sftp-managed-task-manager.ts");

  assert.match(source, /activeBatchId \?\? batchOrder\[0\]/);
  assert.match(source, /if \(activeWorkerCount > 0\) return/);
  assert.doesNotMatch(source, /nextBatchIndex/);
  assert.doesNotMatch(source, /for \(let offset = 0; offset < batchOrder\.length/);
});
