import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_CONVERSATIONS_PER_SERVER,
  createAiConversationRepository,
} from "../../dist-electron/main/storage/ai-conversation-repository.js";
import { CachedStore } from "../../dist-electron/main/storage/cached-store.js";

async function createRepository(
  initial = { conversationsByServer: {}, runtimeContextsByServer: {} },
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbitssh-conversations-"));
  const filePath = path.join(directory, "ai-conversations.json");
  await writeFile(filePath, JSON.stringify(initial));
  const store = new CachedStore(
    { path: filePath, store: structuredClone(initial) },
    { writeDelayMs: 1 },
  );
  return {
    store,
    repository: createAiConversationRepository(store),
    cleanup: async () => {
      await store.whenIdle();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function createConversation(id, updatedAt) {
  return {
    id,
    title: `对话 ${id}`,
    presetPrompt: "",
    messages: [{ id: `${id}-m1`, role: "user", content: "检查服务", createdAt: updatedAt }],
    commandCards: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

const runtimeContext = { summary: "摘要", commands: [], historyFloorCreatedAt: 0 };

test("超出保留数量淘汰最旧对话时一并清理其运行上下文", async () => {
  const { repository, store, cleanup } = await createRepository();
  try {
    for (let index = 0; index < MAX_CONVERSATIONS_PER_SERVER; index += 1) {
      repository.saveConversation({
        serverId: "server-1",
        conversation: createConversation(`c${index}`, 1_000 + index),
      });
      repository.saveConversationRuntimeContext("server-1", `c${index}`, runtimeContext);
    }

    repository.saveConversation({
      serverId: "server-1",
      conversation: createConversation("newest", 9_999),
    });

    const ids = repository.listConversationSummaries("server-1").map(item => item.id);
    assert.equal(ids.length, MAX_CONVERSATIONS_PER_SERVER);
    assert.equal(ids.includes("c0"), false);
    assert.equal(repository.getConversationRuntimeContext("server-1", "c0"), null);
    assert.notEqual(repository.getConversationRuntimeContext("server-1", "c1"), null);
    assert.equal(
      Object.keys(store.read("runtimeContextsByServer")["server-1"]).length,
      MAX_CONVERSATIONS_PER_SERVER - 1,
    );
  } finally {
    await cleanup();
  }
});

test("删除对话和删除服务器都会清理运行上下文", async () => {
  const { repository, store, cleanup } = await createRepository();
  try {
    repository.saveConversation({ serverId: "server-1", conversation: createConversation("a", 1) });
    repository.saveConversationRuntimeContext("server-1", "a", runtimeContext);
    repository.saveConversation({ serverId: "server-2", conversation: createConversation("b", 2) });
    repository.saveConversationRuntimeContext("server-2", "b", runtimeContext);

    assert.equal(repository.deleteConversation("server-1", "a"), true);
    assert.equal(repository.getConversationRuntimeContext("server-1", "a"), null);
    assert.equal("server-1" in store.read("runtimeContextsByServer"), false);

    repository.deleteConversationsByServer("server-2");
    assert.deepEqual(store.read("conversationsByServer"), {});
    assert.deepEqual(store.read("runtimeContextsByServer"), {});
  } finally {
    await cleanup();
  }
});

test("启动时清理旧版本遗留的孤立运行上下文", async () => {
  const { repository, store, cleanup } = await createRepository({
    conversationsByServer: { "server-1": [createConversation("kept", 1)] },
    runtimeContextsByServer: {
      "server-1": { kept: runtimeContext, evicted: runtimeContext },
      "server-gone": { orphan: runtimeContext },
    },
  });
  try {
    assert.equal(repository.pruneOrphanRuntimeContexts(), 2);
    assert.deepEqual(Object.keys(store.read("runtimeContextsByServer")), ["server-1"]);
    assert.deepEqual(Object.keys(store.read("runtimeContextsByServer")["server-1"]), ["kept"]);
    assert.equal(repository.pruneOrphanRuntimeContexts(), 0);
  } finally {
    await cleanup();
  }
});

test("读取的完整记录是独立副本，修改不会污染缓存", async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const conversation = createConversation("a", 1);
    repository.saveConversation({ serverId: "server-1", conversation });
    conversation.messages.push({ id: "late", role: "user", content: "保存后修改", createdAt: 2 });

    const record = repository.getConversationRecord("server-1", "a");
    assert.equal(record.messages.length, 1);
    record.messages.length = 0;
    assert.equal(repository.getConversationRecord("server-1", "a").messages.length, 1);
  } finally {
    await cleanup();
  }
});
