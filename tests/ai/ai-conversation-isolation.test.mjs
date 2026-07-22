import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentUrl = new URL("../../src/main/ai/ai-agent.ts", import.meta.url);
const sharedUrl = new URL("../../src/shared/ai.ts", import.meta.url);

test("AI 流式事件携带会话 ID 且主进程按会话跟踪请求", async () => {
  const [agent, shared] = await Promise.all([
    readFile(agentUrl, "utf8"),
    readFile(sharedUrl, "utf8"),
  ]);

  assert.match(shared, /interface AiChatInput \{\s*tabId: string;\s*conversationId: string;/);
  assert.match(shared, /interface AiStreamChunkEvent \{\s*tabId: string;\s*conversationId: string;/);
  assert.match(shared, /interface AiCommandCardEvent \{\s*tabId: string;\s*conversationId: string;/);
  assert.match(agent, /makeEmitter\(input\.tabId, input\.conversationId, webContents\)/);
  assert.match(agent, /activeRequests\.get\(conversationId\)\?\.controller\.abort\(\)/);
  assert.match(agent, /activeRequests\.set\(conversationId, \{ tabId, controller \}\)/);
  assert.match(agent, /request\.tabId !== input\.tabId/);
});

test("同一标签页的新请求只清理本 AI 会话的审批", async () => {
  const agent = await readFile(agentUrl, "utf8");

  assert.match(agent, /clearPendingApprovalsForConversation\(/);
  assert.match(agent, /value => value\.conversationId === conversationId/);
  assert.match(
    agent,
    /approval\.input\.conversationId !== input\.conversationId/,
  );
  assert.doesNotMatch(
    agent,
    /clearPendingApprovalsForTab\(input\.tabId, "已开始新的 AI 请求"/,
  );
});
