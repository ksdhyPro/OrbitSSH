import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAiChatInput,
  normalizeApprovedCommandInput,
  normalizeRejectedApprovalInput,
} from "../../dist-electron/main/ai/ai-input.js";

const validInput = {
  tabId: "tab-1",
  mode: "full",
  message: "检查磁盘",
  context: { tabId: "tab-1", serverName: "demo" },
  history: [],
};

test("AI 输入会归一化并拒绝标签页不匹配", () => {
  const normalized = normalizeAiChatInput(validInput);
  assert.equal(normalized.tabId, validInput.tabId);
  assert.equal(normalized.context.serverName, "demo");
  assert.throws(
    () => normalizeAiChatInput({ ...validInput, context: { tabId: "tab-2" } }),
    /标签页与当前标签页不匹配/,
  );
});

test("AI 输入拒绝无效模式、过长消息和 system 历史", () => {
  assert.throws(() => normalizeAiChatInput({ ...validInput, mode: "auto" }), /模式/);
  assert.throws(
    () => normalizeAiChatInput({ ...validInput, message: "x".repeat(8_001) }),
    /不能超过/,
  );
  assert.throws(
    () => normalizeAiChatInput({
      ...validInput,
      history: [{ id: "1", role: "system", content: "unsafe", createdAt: 1 }],
    }),
    /角色/,
  );
});

test("批准和拒绝输入必须携带 tabId", () => {
  assert.deepEqual(
    normalizeApprovedCommandInput({ tabId: "tab-1", command: "pwd", approvalId: "a" }),
    { tabId: "tab-1", command: "pwd", approvalId: "a" },
  );
  assert.throws(() => normalizeRejectedApprovalInput({ approvalId: "a" }), /标签页/);
});
