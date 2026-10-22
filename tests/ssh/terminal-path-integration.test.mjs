import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getShellPathIntegrationCommand,
  stripInjectedShellCommandEcho,
} from "../../dist-electron/main/ssh/shell-path-integration.js";

test("按登录 Shell 生成在提示符阶段上报 OSC 7 路径的钩子", () => {
  const bash = getShellPathIntegrationCommand("/bin/bash");
  assert.match(bash, /printf '\\033\]7;file:\/\/%s\\007' "\$PWD"/);
  assert.match(
    bash,
    /PROMPT_COMMAND="__orbitssh_emit_cwd\$\{PROMPT_COMMAND:\+;\$\{PROMPT_COMMAND\}\}"/,
  );
  assert.ok(bash.endsWith("\r"));

  assert.match(
    getShellPathIntegrationCommand("/usr/bin/zsh"),
    /precmd_functions\+=\(__orbitssh_emit_cwd\)/,
  );
  assert.match(getShellPathIntegrationCommand(" /usr/local/bin/FISH "), /--on-variable PWD/);
  assert.equal(getShellPathIntegrationCommand("/bin/sh"), null);
});

test("注入命令的回显即使被拆到多个数据包也会被完整移除", () => {
  const command = getShellPathIntegrationCommand("/bin/zsh");
  const echo = `${command.replace(/\r$/, "")}\r\n`;
  const output = `last login\r\n${echo}user@host ~ % `;
  // 用不同的包大小模拟 SSH 拆包，覆盖换行落在下一包、\r 与 \n 被拆开等情况。
  for (let size = 1; size <= 12; size += 1) {
    const state = { pendingShellCommandEcho: command };
    const packets = output.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"));

    const forwarded = packets.map(packet => stripInjectedShellCommandEcho(state, packet)).join("");

    assert.equal(forwarded, "last login\r\nuser@host ~ % ", `包大小 ${size}`);
    assert.equal(state.pendingShellCommandEcho, undefined);
    assert.equal(state.pendingShellCommandEchoLineBreak, undefined);
  }
});

test("没有待移除的注入命令时原样转发终端数据", () => {
  assert.equal(stripInjectedShellCommandEcho({}, "ls -la\r\n"), "ls -la\r\n");
});

test("终端数据转发前经过回显过滤", async () => {
  const source = await readFile(
    new URL("../../src/main/ssh/session-manager.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /data = stripInjectedShellCommandEcho\(session, data\)/);
  assert.match(source, /session\.pendingShellCommandEcho = command;/);
});
