import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("生产入口会在加载业务模块前记录启动诊断", async () => {
  const bootstrapSource = await readFile(
    new URL("../../src/main/bootstrap.ts", import.meta.url),
    "utf8",
  );
  const packageSource = await readFile(new URL("../../package.json", import.meta.url), "utf8");

  assert.match(bootstrapSource, /主进程开始启动/);
  assert.match(bootstrapSource, /import\("\.\/index\.js"\)/);
  assert.match(bootstrapSource, /主进程业务模块加载失败/);
  assert.match(packageSource, /dist-electron\/main\/bootstrap\.js/);
});

test("主窗口和子进程异常会写入启动诊断", async () => {
  const source = await readFile(new URL("../../src/main/index.ts", import.meta.url), "utf8");

  assert.match(source, /render-process-gone/);
  assert.match(source, /did-fail-load/);
  assert.match(source, /child-process-gone/);
  assert.match(source, /Electron 应用 ready/);
  assert.match(source, /主窗口创建成功/);
  assert.match(source, /应用初始化失败/);
});

test("启动诊断日志目录在各平台都落在用户可写目录", async () => {
  const { getStartupDiagnosticsDirectory } =
    await import("../../dist-electron/main/startup-diagnostics.js");

  assert.equal(
    getStartupDiagnosticsDirectory(
      "win32",
      { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" },
      "C:\\Users\\a",
    ),
    "C:\\Users\\a\\AppData\\Local\\OrbitSSH\\logs",
  );
  assert.equal(
    getStartupDiagnosticsDirectory("darwin", {}, "/Users/a"),
    "/Users/a/Library/Logs/OrbitSSH",
  );
  assert.equal(
    getStartupDiagnosticsDirectory("linux", {}, "/home/a"),
    "/home/a/.local/state/OrbitSSH/logs",
  );
  assert.equal(
    getStartupDiagnosticsDirectory("linux", { XDG_STATE_HOME: "/state" }, "/home/a"),
    "/state/OrbitSSH/logs",
  );
});
