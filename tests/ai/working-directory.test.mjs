import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSshCommandInWorkingDirectory,
  quotePosixShellArgument,
} from "../../dist-electron/main/ssh/terminal-command.js";

test("SSH AI 命令显式绑定工作目录", () => {
  assert.equal(
    buildSshCommandInWorkingDirectory("pwd", "/srv/orbit ssh"),
    "cd -- '/srv/orbit ssh' && pwd",
  );
});

test("SSH 工作目录中的单引号不会形成命令注入", () => {
  assert.equal(
    quotePosixShellArgument("/srv/a'b"),
    "'/srv/a'\"'\"'b'",
  );
});
