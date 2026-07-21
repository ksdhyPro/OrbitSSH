import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsUrl = new URL("../../src/shared/settings.ts", import.meta.url);
const storeUrl = new URL("../../src/main/storage/settings-store.ts", import.meta.url);
const agentUrl = new URL("../../src/main/ai/ai-agent.ts", import.meta.url);
const dialogUrl = new URL(
  "../../src/renderer/components/SettingsDialog.vue",
  import.meta.url,
);

test("AI 命令默认超时 10 分钟且可配置为不限时", async () => {
  const [settings, store, agent, dialog] = await Promise.all([
    readFile(settingsUrl, "utf8"),
    readFile(storeUrl, "utf8"),
    readFile(agentUrl, "utf8"),
    readFile(dialogUrl, "utf8"),
  ]);

  assert.match(settings, /commandTimeoutMinutes:\s*10/);
  assert.match(store, /normalizeCommandTimeoutMinutes/);
  assert.match(agent, /settings\.ai\.commandTimeoutMinutes \* 60_000/);
  assert.match(dialog, /appSettings\.ai\.commandTimeoutMinutes/);
  assert.match(dialog, /'commandTimeoutMinutes'/);
});

test("命令超时后立即结束本轮 Agent，不再把结果交给模型重试", async () => {
  const agent = await readFile(agentUrl, "utf8");

  assert.match(agent, /if \(result\.timedOut\) \{/);
  assert.match(agent, /本轮 AI 自动执行已停止，不会再次请求或重复执行该命令/);
  assert.match(
    agent,
    /return \{ status: "return", result: \{ messages, commandCards: nextCards \} \}/,
  );
});
