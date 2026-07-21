import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTerminalOutputForXterm } from "../../dist-electron/main/ssh/terminal-output.js";

test("AI exec 输出回写 xterm 时统一使用 CRLF", () => {
  assert.equal(
    normalizeTerminalOutputForXterm("one\ntwo\rthree\r\nfour"),
    "one\r\ntwo\rthree\r\nfour",
  );
});

test("Docker 等工具使用单独 CR 刷新进度时不会展开成多行", () => {
  assert.equal(
    normalizeTerminalOutputForXterm("Downloading 20%\rDownloading 40%\r"),
    "Downloading 20%\rDownloading 40%\r",
  );
});
