import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  buildAiMessages,
  stripTerminalControlSequences,
} from "../../dist-electron/main/ai/ai-context.js";
import {
  executeLocalTerminalCommand,
  executeSshTerminalCommand,
} from "../../dist-electron/main/ssh/terminal-command.js";

test("去掉颜色、光标与标题控制序列，回车改写统一为换行", () => {
  const raw = "\x1b]0;user@host: ~\x07\x1b[1;32mOK\x1b[0m done\r\n50%\r100%\x1b[2K\x1b(B\x07";
  assert.equal(stripTerminalControlSequences(raw), "OK done\n50%\n100%");
});

test("发送给模型的终端上下文和工具结果不包含控制序列", () => {
  const messages = buildAiMessages(
    {
      tabId: "tab-1",
      requestId: "r",
      conversationId: "c",
      mode: "auto",
      presetPrompt: "",
      conversationTitle: "t",
      conversationCreatedAt: 1,
      messageId: "m",
      messageCreatedAt: 2,
      message: "看下状态",
      context: { tabId: "tab-1", serverId: "s" },
      history: [],
    },
    [
      {
        toolCallId: "call-1",
        toolName: "run_shell_command",
        command: "ls --color=always",
        reason: "列目录",
        risk: "low",
        result: {
          stdout: "\x1b[01;34mlogs\x1b[0m",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 1,
        },
      },
    ],
    "\x1b[31merror\x1b[0m line",
  );

  const serialized = JSON.stringify(messages);
  assert.doesNotMatch(serialized, /\\u001b/);
  assert.match(serialized, /logs/);
  assert.match(serialized, /error line/);
});

function createFakeSshClient(chunks) {
  return {
    exec(_command, callback) {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.signal = () => undefined;
      stream.close = () => undefined;
      stream.destroy = () => undefined;
      callback(undefined, stream);
      setImmediate(() => {
        for (const chunk of chunks) stream.emit("data", chunk);
        stream.emit("close", 0);
      });
    },
  };
}

test("SSH 命令输出中被拆开的多字节字符不会乱码", async () => {
  const text = Buffer.from("磁盘使用率：正常 ✅", "utf8");
  // 每 1 个字节一块，强制把每个中文字符拆到多个数据块中。
  const chunks = Array.from(text, byte => Buffer.from([byte]));
  const streamed = [];

  const result = await executeSshTerminalCommand(
    createFakeSshClient(chunks),
    "df -h",
    5_000,
    undefined,
    undefined,
    (_stream, chunk) => streamed.push(chunk),
  );

  assert.equal(result.stdout, "磁盘使用率：正常 ✅");
  assert.equal(streamed.join(""), "磁盘使用率：正常 ✅");
  assert.doesNotMatch(streamed.join(""), /�/);
});

test("本地流式命令同样按流解码", async () => {
  const chunks = [];
  const result = await executeLocalTerminalCommand(
    process.cwd(),
    `node -e "const b=Buffer.from('中文输出'); for (const x of b) process.stdout.write(Buffer.from([x]))"`,
    10_000,
    undefined,
    (_stream, text) => chunks.push(text),
  );

  assert.equal(result.stdout, "中文输出");
  assert.doesNotMatch(chunks.join(""), /�/);
});
