import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertSavedServerTargetUnchanged,
  formatSavedServerTarget,
  resolveSavedServerTarget,
} from "../../dist-electron/main/ai/ai-saved-server-target.js";

const servers = [
  { id: "1", name: "prod", host: "10.0.0.1", port: 22, username: "root" },
  { id: "2", name: "prod-db", host: "10.0.0.2", port: 22, username: "postgres" },
  { id: "3", name: "备份服务器", host: "backup.example.com", port: 2222, username: "ops" },
  { id: "4", name: "web-a", host: "10.0.1.1", port: 22, username: "deploy" },
  { id: "5", name: "web-b", host: "10.0.1.2", port: 22, username: "deploy" },
];

test("名称完全一致时优先于模糊匹配", () => {
  assert.equal(resolveSavedServerTarget("prod", servers).id, "1");
  assert.equal(resolveSavedServerTarget("PROD-DB", servers).id, "2");
});

test("支持按主机和 主机:端口 精确定位，名称中的“服务器”字样可省略", () => {
  assert.equal(resolveSavedServerTarget("10.0.0.2", servers).id, "2");
  assert.equal(resolveSavedServerTarget("backup.example.com:2222", servers).id, "3");
  assert.equal(resolveSavedServerTarget("备份", servers).id, "3");
});

test("唯一的模糊匹配可用，多个候选或找不到时拒绝执行", () => {
  assert.equal(resolveSavedServerTarget("db", servers).id, "2");
  assert.throws(
    () => resolveSavedServerTarget("web", servers),
    /匹配多个连接：web-a（deploy@10\.0\.1\.1:22）、web-b/,
  );
  assert.throws(() => resolveSavedServerTarget("staging", servers), /未找到已保存的服务器/);
  assert.throws(() => resolveSavedServerTarget("  ", servers), /服务器名称不能为空/);
});

test("审批卡展示实际目标，审批后地址或账号变更时不执行", () => {
  const target = resolveSavedServerTarget("db", servers);
  assert.equal(formatSavedServerTarget(target), "prod-db（postgres@10.0.0.2:22）");

  assert.doesNotThrow(() => assertSavedServerTargetUnchanged(target, servers[1]));
  assert.throws(
    () => assertSavedServerTargetUnchanged(target, { ...servers[1], host: "203.0.113.9" }),
    /审批后已被修改/,
  );
  assert.throws(
    () => assertSavedServerTargetUnchanged(target, { ...servers[1], username: "root" }),
    /审批后已被修改/,
  );
});

test("跨服务器动作在审批前解析目标，执行时按已确认的服务器 ID 连接", async () => {
  // 以下模块依赖 Electron 存储，无法在纯 Node 环境加载，这里确认调用关系。
  const [actions, command] = await Promise.all([
    readFile(new URL("../../src/main/ai/ai-agent-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/main/ai/ai-saved-server-command.ts", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /const resolved = resolveSavedServerAction\(rawRequest\);/);
  assert.match(actions, /targetServer:/);
  assert.match(command, /getServerAuthConfig\(input\.target\.id\)/);
  assert.match(command, /assertSavedServerTargetUnchanged\(input\.target, server\)/);
  const executeInput =
    command.match(/interface ExecuteSavedServerCommandInput \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(executeInput, /target: SavedServerTarget/);
  assert.doesNotMatch(executeInput, /serverReference/);
});
