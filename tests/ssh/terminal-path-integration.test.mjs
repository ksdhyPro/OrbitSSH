import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SSH 交互 Shell 会在提示符阶段上报实时目录", async () => {
  const source = await readFile(
    new URL("../../src/main/ssh/session-manager.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /function getShellPathIntegrationCommand/);
  assert.match(source, /case "bash"/);
  assert.match(source, /case "zsh"/);
  assert.match(source, /PROMPT_COMMAND=/);
  assert.match(source, /precmd_functions\+=\(__orbitssh_emit_cwd\)/);
  assert.match(source, /实时终端路径同步已启用/);
});
