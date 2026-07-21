import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTerminalOutputForXterm } from "../../dist-electron/main/ssh/terminal-output.js";

test("AI exec 输出回写 xterm 时统一使用 CRLF", () => {
  assert.equal(
    normalizeTerminalOutputForXterm("one\ntwo\rthree\r\nfour"),
    "one\r\ntwo\r\nthree\r\nfour",
  );
});
