import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storeUrl = new URL(
  "../../src/renderer/stores/useTerminalsStore.ts",
  import.meta.url,
);
const pasteUtilityUrl = new URL(
  "../../src/renderer/utils/terminal-paste.ts",
  import.meta.url,
);
const panelUrl = new URL(
  "../../src/renderer/components/TerminalPanel.vue",
  import.meta.url,
);

test("多行终端粘贴等待确认并保留原始文本", async () => {
  const [storeSource, pasteUtilitySource, panelSource] = await Promise.all([
    readFile(storeUrl, "utf8"),
    readFile(pasteUtilityUrl, "utf8"),
    readFile(panelUrl, "utf8"),
  ]);

  assert.match(pasteUtilitySource, /function hasTextLineBreak[\s\S]*?\/\\r\|\\n\//);
  assert.match(pasteUtilitySource, /pendingPaste\.text/);
  assert.match(pasteUtilitySource, /addEventListener\("paste", handlePaste, true\)/);
  assert.match(pasteUtilitySource, /event\.preventDefault\(\)/);
  assert.doesNotMatch(
    pasteUtilitySource.match(/function confirmTerminalPaste[\s\S]*?\n  }/)?.[0] ?? "",
    /trim\(|replace\(/,
  );
  assert.match(storeSource, /requestTerminalPaste\(tabId, clipboardText\)/);
  assert.match(panelSource, /<AppDialog[\s\S]*?确认粘贴多行文本/);
  assert.match(panelSource, /terminal-paste-preview/);
});

test("普通回车不会触发多行粘贴确认", async () => {
  const pasteUtilitySource = await readFile(pasteUtilityUrl, "utf8");

  assert.match(
    pasteUtilitySource,
    /data\.length > 1 && hasTextLineBreak\(data\)/,
  );
});

test("确认多行内容后交给 xterm 按粘贴语义发送", async () => {
  const pasteUtilitySource = await readFile(pasteUtilityUrl, "utf8");

  assert.match(
    pasteUtilitySource,
    /options\.paste\(pendingPaste\.tabId, pendingPaste\.text\)/,
  );
});
