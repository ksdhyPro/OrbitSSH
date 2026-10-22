import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAiChatInput,
  normalizeAiCancelInput,
  normalizeApprovedCommandInput,
  normalizeRejectedApprovalInput,
} from "../../dist-electron/main/ai/ai-input.js";

const validInput = {
  tabId: "tab-1",
  requestId: "request-1",
  conversationId: "conversation-1",
  mode: "auto",
  presetPrompt: "使用简洁中文回答",
  conversationTitle: "检查磁盘",
  conversationCreatedAt: 1,
  messageId: "message-1",
  messageCreatedAt: 2,
  message: "检查磁盘",
  context: { tabId: "tab-1", serverId: "server-1", serverName: "demo" },
  history: [],
};

test("AI 输入会归一化并拒绝标签页不匹配", () => {
  const normalized = normalizeAiChatInput(validInput);
  assert.equal(normalized.tabId, validInput.tabId);
  assert.equal(normalized.context.serverName, "demo");
  assert.equal(normalized.presetPrompt, validInput.presetPrompt);
  assert.throws(
    () =>
      normalizeAiChatInput({
        ...validInput,
        context: { tabId: "tab-2", serverId: "server-1" },
      }),
    /标签页与当前标签页不匹配/,
  );
});

test("AI 输入拒绝无效模式、过长消息和 system 历史", () => {
  assert.throws(() => normalizeAiChatInput({ ...validInput, mode: "unsafe" }), /模式/);
  assert.throws(
    () => normalizeAiChatInput({ ...validInput, message: "x".repeat(8_001) }),
    /不能超过/,
  );
  assert.throws(
    () =>
      normalizeAiChatInput({
        ...validInput,
        history: [{ id: "1", role: "system", content: "unsafe", createdAt: 1 }],
      }),
    /角色/,
  );
});

test("批准、拒绝和取消输入必须携带请求身份", () => {
  assert.deepEqual(
    normalizeApprovedCommandInput({
      tabId: "tab-1",
      requestId: "request-2",
      conversationId: "conversation-1",
      command: "pwd",
      approvalId: "a",
    }),
    {
      tabId: "tab-1",
      requestId: "request-2",
      conversationId: "conversation-1",
      command: "pwd",
      approvalId: "a",
    },
  );
  assert.throws(() => normalizeRejectedApprovalInput({ approvalId: "a" }), /标签页/);
  assert.throws(() => normalizeAiCancelInput({ tabId: "tab-1" }), /请求 ID/);
});

test("AI 预提示词允许为空并限制最大长度", () => {
  assert.equal(normalizeAiChatInput({ ...validInput, presetPrompt: "" }).presetPrompt, "");
  assert.throws(
    () => normalizeAiChatInput({ ...validInput, presetPrompt: "x".repeat(8_001) }),
    /预提示词不能超过/,
  );
});

test("AI 输入接受三档权限模式", () => {
  for (const mode of ["ask", "auto", "full_access"]) {
    assert.equal(normalizeAiChatInput({ ...validInput, mode }).mode, mode);
  }
  assert.throws(() => normalizeAiChatInput({ ...validInput, mode: "full" }), /AI 模式/);
});

test("历史中的超长回复会被截断而不是让后续请求全部失败", () => {
  const longReply = "排查报告".repeat(3_000);
  const normalized = normalizeAiChatInput({
    ...validInput,
    history: [
      { id: "1", role: "user", content: "写一份完整报告", createdAt: 1 },
      { id: "2", role: "assistant", content: longReply, createdAt: 2 },
      { id: "3", role: "assistant", content: "   ", createdAt: 3 },
    ],
  });

  assert.equal(normalized.history.length, 2);
  assert.equal(normalized.history[1].content.length, 8_000);
  assert.match(normalized.history[1].content, /历史消息过长，已截断/);
});

test("历史超出条数或总长度时保留最新的消息", () => {
  const history = Array.from({ length: 600 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(7_000),
    createdAt: index,
  }));
  const normalized = normalizeAiChatInput({ ...validInput, history });

  assert.ok(normalized.history.length <= 500);
  assert.ok(
    normalized.history.reduce((total, item) => total + item.content.length, 0) <= 1_000_000,
  );
  assert.equal(normalized.history.at(-1).id, "m599");
});
