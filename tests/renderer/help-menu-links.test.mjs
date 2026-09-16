import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("帮助菜单提供提交反馈和更新日志外链", async () => {
  const [titleBarSource, helpLinksSource, preloadSource, preloadCjsSource] =
    await Promise.all([
      readFile(
        new URL("../../src/renderer/components/TitleBarTabs.vue", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../../src/shared/help-links.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/preload/index.cjs", import.meta.url), "utf8"),
    ]);

  assert.match(titleBarSource, /label: "提交反馈"/);
  assert.match(titleBarSource, /label: "更新日志"/);
  assert.match(helpLinksSource, /https:\/\/gitee\.com\/ksdhy\/orbit-ssh\/issues/);
  assert.match(
    helpLinksSource,
    /https:\/\/gitee\.com\/ksdhy\/orbit-ssh\/blob\/master\/docs\/update\.md/,
  );
  assert.match(preloadSource, /help:open-feedback/);
  assert.match(preloadSource, /help:open-changelog/);
  assert.match(preloadCjsSource, /help:open-feedback/);
  assert.match(preloadCjsSource, /help:open-changelog/);
});
