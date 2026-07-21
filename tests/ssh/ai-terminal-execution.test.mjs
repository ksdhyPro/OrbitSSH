import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  executeLocalTerminalCommand,
  executeSshTerminalCommand,
} from "../../dist-electron/main/ssh/terminal-command.js";

class FakeChannel extends EventEmitter {
  stderr = new EventEmitter();
  signals = [];
  closed = false;

  signal(name) {
    this.signals.push(name);
  }

  close() {
    this.closed = true;
  }

  destroy() {
    this.closed = true;
  }
}

test("SSH AI 命令输出会在结束前逐块转发", async () => {
  const channel = new FakeChannel();
  const chunks = [];
  const client = {
    exec(_command, callback) {
      callback(null, channel);
      setImmediate(() => {
        channel.emit("data", Buffer.from("one\n"));
        channel.stderr.emit("data", Buffer.from("two\n"));
        channel.emit("close", 0);
      });
    },
  };

  const result = await executeSshTerminalCommand(
    client,
    "demo",
    1_000,
    undefined,
    (chunk, stream) => chunks.push([stream, chunk]),
  );

  assert.deepEqual(chunks, [
    ["stdout", "one\n"],
    ["stderr", "two\n"],
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "one\n");
  assert.equal(result.stderr, "two\n");
});

test("SSH AI 命令超时会发送 INT 并关闭 exec channel", async () => {
  const channel = new FakeChannel();
  const client = {
    exec(_command, callback) {
      callback(null, channel);
    },
  };

  const result = await executeSshTerminalCommand(client, "tail -f log", 10);
  assert.equal(result.timedOut, true);
  assert.deepEqual(channel.signals, ["INT"]);
  assert.equal(channel.closed, true);
});

test("本地 AI 命令按块输出并保留退出码", async () => {
  const chunks = [];
  const result = await executeLocalTerminalCommand(
    process.cwd(),
    `${JSON.stringify(process.execPath)} -e "process.stdout.write('live')"`,
    2_000,
    undefined,
    chunk => chunks.push(chunk),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "live");
  assert.equal(chunks.join(""), "live");
});

test("会话管理器锁定当前 Tab、排除镜像上下文并最终 Ctrl+C 解锁", async () => {
  const source = await readFile(
    new URL("../../src/main/ssh/session-manager.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /setAiTerminalInputLocked\(session, true\)/);
  assert.match(source, /forwardTerminalData\([\s\S]*false,[\s\S]*\)/);
  assert.match(source, /writeRawTerminalInput\(session, "\\x03"\)/);
  assert.match(source, /finally \{\s*setAiTerminalInputLocked\(session, false\)/);
  assert.match(source, /if \(session\.aiInputLocked\) \{\s*return false/);
});
