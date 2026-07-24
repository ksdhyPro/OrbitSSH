import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const statusBarUrl = new URL(
  "../../src/renderer/components/StatusBar.vue",
  import.meta.url,
);
const statsCollectorUrl = new URL(
  "../../src/main/ssh/terminal-system-stats.ts",
  import.meta.url,
);

test("状态栏轮询显示磁盘总量和每个挂载点并提供完整明细", async () => {
  const [statusBar, collector] = await Promise.all([
    readFile(statusBarUrl, "utf8"),
    readFile(statsCollectorUrl, "utf8"),
  ]);

  assert.match(collector, /df -Pk/);
  assert.match(collector, /disks:\s*SystemDiskStats\[\]/);
  assert.match(statusBar, /label:\s*"总量"/);
  assert.match(statusBar, /\.\.\.s\.disks\.map/);
  assert.match(statusBar, /diskDisplayIndex\.value \+ 1/);
  assert.match(statusBar, /class="status-bar-disk-details"/);
  assert.match(statusBar, /\}, 5000\)/);
});
