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
  conversationId: "conversation-1",
  mode: "full",
  message: "检查磁盘",
  context: { tabId: "tab-1", serverName: "demo" },
  history: [],
};

test("AI 输入会归一化并拒绝标签页不匹配", () => {
  const normalized = normalizeAiChatInput(validInput);
  assert.equal(normalized.tabId, validInput.tabId);
  assert.equal(normalized.conversationId, validInput.conversationId);
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

test("AI 输入接受附件并允许省略文本消息", () => {
  const attachment = {
    name: "screen.png",
    mimeType: "image/png",
    size: 3,
    dataUrl: "data:image/png;base64,YWJj",
  };
  const normalized = normalizeAiChatInput({
    ...validInput,
    message: "",
    attachments: [attachment],
  });

  assert.equal(normalized.message, "请分析这些附件");
  assert.deepEqual(normalized.attachments, [{
    ...attachment,
    id: "attachment-1",
    delivery: "inline",
  }]);
});

test("AI 附件大小上限可配置为 1 到 64 MB", () => {
  const attachment = {
    name: "large.log",
    mimeType: "text/plain",
    size: 12 * 1024 * 1024,
    dataUrl: "data:text/plain;base64,YWJj",
    delivery: "chunked",
  };

  assert.throws(
    () => normalizeAiChatInput({ ...validInput, attachments: [attachment] }),
    /附件大小不能超过 8 MB/,
  );
  const normalized = normalizeAiChatInput(
    { ...validInput, attachments: [attachment] },
    16,
  );
  assert.equal(normalized.attachments[0].delivery, "chunked");
  assert.equal(normalized.attachments[0].size, attachment.size);
});

test("只有文本类附件可以使用分段读取", () => {
  assert.throws(
    () => normalizeAiChatInput({
      ...validInput,
      attachments: [{
        name: "large.png",
        mimeType: "image/png",
        size: 3,
        dataUrl: "data:image/png;base64,YWJj",
        delivery: "chunked",
      }],
    }),
    /只有文本、代码、配置和日志附件可以分段读取/,
  );
});

test("AI 输入接受有覆盖边界的模型语义摘要", () => {
  const compaction = {
    content: "目标与状态：继续排查服务。",
    coveredThroughMessageId: "message-8",
    coveredThroughCreatedAt: 8,
    updatedAt: 9,
  };
  const normalized = normalizeAiChatInput({
    ...validInput,
    compaction,
  });

  assert.deepEqual(normalized.compaction, compaction);
  assert.throws(
    () => normalizeAiChatInput({
      ...validInput,
      compaction: { ...compaction, coveredThroughCreatedAt: "invalid" },
    }),
    /摘要时间无效/,
  );
});

test("AI 输入拒绝过多、过大或格式不匹配的附件", () => {
  const attachment = {
    name: "screen.png",
    mimeType: "image/png",
    size: 3,
    dataUrl: "data:image/png;base64,YWJj",
  };

  assert.throws(
    () => normalizeAiChatInput({ ...validInput, attachments: Array(5).fill(attachment) }),
    /最多允许 4 个/,
  );
  assert.throws(
    () => normalizeAiChatInput({
      ...validInput,
      attachments: [{ ...attachment, size: 8 * 1024 * 1024 + 1 }],
    }),
    /附件大小/,
  );
  assert.throws(
    () => normalizeAiChatInput({
      ...validInput,
      attachments: [{ ...attachment, dataUrl: "data:text/plain;base64,YWJj" }],
    }),
    /数据格式无效/,
  );
});

test("批准、拒绝和取消输入必须同时携带 tabId 与 conversationId", () => {
  assert.deepEqual(
    normalizeApprovedCommandInput({
      tabId: "tab-1",
      conversationId: "conversation-1",
      command: "pwd",
      approvalId: "a",
    }),
    {
      tabId: "tab-1",
      conversationId: "conversation-1",
      command: "pwd",
      approvalId: "a",
    },
  );
  assert.throws(() => normalizeRejectedApprovalInput({ approvalId: "a" }), /标签页/);
  assert.throws(
    () => normalizeRejectedApprovalInput({ tabId: "tab-1", approvalId: "a" }),
    /会话 ID/,
  );
  assert.deepEqual(
    normalizeAiCancelInput({
      tabId: "tab-1",
      conversationId: "conversation-1",
    }),
    { tabId: "tab-1", conversationId: "conversation-1" },
  );
});
