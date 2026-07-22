import assert from "node:assert/strict";
import test from "node:test";

import { ExpiringApprovalStore } from "../../dist-electron/main/ai/ai-approval-store.js";

test("审批只能被取出一次", () => {
  const store = new ExpiringApprovalStore();
  store.set("approval-1", { tabId: "tab-1", command: "pwd" }, 1_000);
  assert.deepEqual(store.take("approval-1"), { tabId: "tab-1", command: "pwd" });
  assert.equal(store.take("approval-1"), null);
});

test("可按标签页清理审批且不影响其他标签页", () => {
  const store = new ExpiringApprovalStore();
  store.set("a", { tabId: "tab-1" }, 1_000);
  store.set("b", { tabId: "tab-2" }, 1_000);
  assert.deepEqual(store.clearForTab("tab-1").map(item => item.id), ["a"]);
  assert.equal(store.get("a"), null);
  assert.deepEqual(store.get("b"), { tabId: "tab-2" });
});

test("审批到期后主动清理并触发通知", async () => {
  const store = new ExpiringApprovalStore();
  let expiredId = "";
  store.set("expired", { tabId: "tab-1" }, 10, id => {
    expiredId = id;
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(store.get("expired"), null);
  assert.equal(expiredId, "expired");
});

test("可按会话筛选清理审批且不影响同一标签页的其他会话", () => {
  const store = new ExpiringApprovalStore();
  store.set("a", { tabId: "tab-1", conversationId: "conversation-1" }, 1_000);
  store.set("b", { tabId: "tab-1", conversationId: "conversation-2" }, 1_000);

  assert.deepEqual(
    store.clearMatching(value => value.conversationId === "conversation-1")
      .map(item => item.id),
    ["a"],
  );
  assert.equal(store.get("a"), null);
  assert.deepEqual(store.get("b"), {
    tabId: "tab-1",
    conversationId: "conversation-2",
  });
});

test("审批有效期为 0 时不会自动过期", async () => {
  const store = new ExpiringApprovalStore();
  let expired = false;
  store.set("persistent", { tabId: "tab-1" }, 0, () => {
    expired = true;
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(store.get("persistent"), { tabId: "tab-1" });
  assert.equal(expired, false);
});
