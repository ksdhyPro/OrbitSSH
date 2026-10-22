import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";

import { useAiStore } from "../../src/renderer/stores/useAiStore";
import { useSettingsStore } from "../../src/renderer/stores/useSettingsStore";
import type { AiChatInput, AiChatResult, AiCommandCard } from "../../src/shared/ai";
import { createDeferred, installOrbitApiMock } from "./helpers/orbit-api";

const contextA = { tabId: "tab-a", serverId: "server-a" };
const contextB = { tabId: "tab-b", serverId: "server-b" };

function createCard(overrides: Partial<AiCommandCard>): AiCommandCard {
  return {
    id: "card-1",
    tabId: "tab-a",
    conversationId: "",
    command: "uptime",
    reason: "查看负载",
    risk: "low",
    status: "completed",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("useAiStore", () => {
  let mock: ReturnType<typeof installOrbitApiMock>;

  beforeEach(() => {
    mock = installOrbitApiMock();
    setActivePinia(createPinia());
  });

  async function startPendingChat(store: ReturnType<typeof useAiStore>, context = contextA) {
    const deferred = createDeferred<AiChatResult>();
    mock.api.ai.chat.mockReturnValueOnce(deferred.promise);
    store.setActiveTabId(context.tabId, context.serverId);
    store.inputText = "检查磁盘";
    const sending = store.sendMessage(context);
    await nextTick();
    const input = mock.api.ai.chat.mock.calls.at(-1)![0] as AiChatInput;
    return { deferred, sending, input };
  }

  it("请求状态按标签页隔离，并按当前请求 ID 精确取消", async () => {
    const store = useAiStore();
    const { deferred, sending, input } = await startPendingChat(store);

    expect(store.isSending).toBe(true);
    store.setActiveTabId(contextB.tabId, contextB.serverId);
    expect(store.isSending).toBe(false);

    store.setActiveTabId(contextA.tabId, contextA.serverId);
    await store.cancelMessage(contextA);
    expect(mock.api.ai.cancel).toHaveBeenCalledWith({
      tabId: "tab-a",
      requestId: input.requestId,
    });

    deferred.resolve({ messages: [], commandCards: [] });
    await sending;
    expect(store.isSending).toBe(false);
  });

  it("流式消息只路由到同一请求和对话，结束后由最终结果替换占位", async () => {
    const store = useAiStore();
    const { deferred, sending, input } = await startPendingChat(store);
    const route = {
      tabId: input.tabId,
      requestId: input.requestId,
      conversationId: input.conversationId,
    };

    mock.emitStreamMessageStart({ ...route, messageId: "stream-1", createdAt: Date.now() + 1 });
    mock.emitStreamChunk({ ...route, messageId: "stream-1", chunk: "正在" });
    mock.emitStreamChunk({
      ...route,
      conversationId: "other",
      messageId: "stream-1",
      chunk: "串流",
    });
    mock.emitStreamChunk({ ...route, requestId: "other", messageId: "stream-1", chunk: "串流" });
    mock.emitStreamChunk({ ...route, messageId: "stream-1", chunk: "检查" });

    expect(store.messages.find(message => message.id === "stream-1")?.content).toBe("正在检查");

    deferred.resolve({
      messages: [
        { id: "final-1", role: "assistant", content: "磁盘正常", createdAt: Date.now() + 2 },
      ],
      commandCards: [],
    });
    await sending;

    expect(store.messages.some(message => message.id === "stream-1")).toBe(false);
    expect(store.messages.at(-1)?.content).toBe("磁盘正常");
  });

  it("进度消息支持整体替换内容，长命令进度不会越积越长", async () => {
    const store = useAiStore();
    const { deferred, sending, input } = await startPendingChat(store);
    const route = {
      tabId: input.tabId,
      requestId: input.requestId,
      conversationId: input.conversationId,
    };

    mock.emitStreamMessageStart({ ...route, messageId: "progress-1", createdAt: Date.now() + 1 });
    mock.emitStreamChunk({
      ...route,
      messageId: "progress-1",
      chunk: "下载到 30%\n\n已运行 30 秒",
    });
    mock.emitStreamChunk({
      ...route,
      messageId: "progress-1",
      chunk: "下载到 80%\n\n已运行 2 分 0 秒",
      replace: true,
    });

    expect(store.messages.find(message => message.id === "progress-1")?.content).toBe(
      "下载到 80%\n\n已运行 2 分 0 秒",
    );
    deferred.resolve({ messages: [], commandCards: [] });
    await sending;
  });

  it("命令卡事件只合并到身份一致的对话", async () => {
    const store = useAiStore();
    const { deferred, sending, input } = await startPendingChat(store);
    const route = {
      tabId: input.tabId,
      requestId: input.requestId,
      conversationId: input.conversationId,
    };

    mock.emitCommandCard({
      ...route,
      card: createCard({ id: "mismatch", conversationId: "other" }),
    });
    mock.emitCommandCard({
      ...route,
      card: createCard({ id: "match", conversationId: input.conversationId }),
    });

    expect(store.commandCards.map(card => card.id)).toEqual(["match"]);
    deferred.resolve({ messages: [], commandCards: [] });
    await sending;
  });

  it("事件监听器在 Store 生命周期内只注册一次，并在销毁时注销", () => {
    const store = useAiStore();
    useAiStore();

    expect(mock.api.ai.onStreamMessageStart).toHaveBeenCalledTimes(1);
    expect(mock.api.ai.onStreamChunk).toHaveBeenCalledTimes(1);
    expect(mock.api.ai.onCommandCard).toHaveBeenCalledTimes(1);

    expect(mock.listenerCount()).toBe(3);
    store.$dispose();
    expect(mock.listenerCount()).toBe(0);
  });

  it("预提示词按对话创建时的快照发送，新对话才使用新设置", async () => {
    const settings = useSettingsStore();
    settings.appSettings.ai.presetPrompt = "回答尽量简短";
    const store = useAiStore();

    const first = await startPendingChat(store);
    settings.appSettings.ai.presetPrompt = "回答详细说明原因";
    first.deferred.resolve({ messages: [], commandCards: [] });
    await first.sending;

    const second = await startPendingChat(store);
    expect(first.input.presetPrompt).toBe("回答尽量简短");
    expect(second.input.presetPrompt).toBe("回答尽量简短");
    second.deferred.resolve({ messages: [], commandCards: [] });
    await second.sending;

    store.startNewConversation("tab-a");
    const third = await startPendingChat(store);
    expect(third.input.presetPrompt).toBe("回答详细说明原因");
    expect(third.input.conversationId).not.toBe(first.input.conversationId);
    third.deferred.resolve({ messages: [], commandCards: [] });
    await third.sending;
  });
});
