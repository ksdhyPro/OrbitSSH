import Store from "electron-store";

import { writeAppLog } from "../logger.js";
import {
  createAiConversationRepository,
  type AiConversationStoreSchema,
} from "./ai-conversation-repository.js";
import { CachedStore } from "./cached-store.js";

export type {
  AiPersistedConversationContext,
  AiSaveConversationInput,
} from "./ai-conversation-repository.js";

// 对话历史体积大、写入频繁：读取走内存缓存，修改在 300ms 内合并后异步原子写盘，退出前同步落盘。
const store = new CachedStore<AiConversationStoreSchema>(
  new Store<AiConversationStoreSchema>({
    name: "ai-conversations",
    defaults: {
      conversationsByServer: {},
      runtimeContextsByServer: {},
    },
  }),
  {
    writeDelayMs: 300,
    onWriteError: error => {
      writeAppLog({
        scope: "main.ai",
        level: "error",
        message: "AI 对话历史写入失败",
        data: { error: error instanceof Error ? error.message : String(error) },
      });
    },
  },
);

const repository = createAiConversationRepository(store);

export const {
  listConversationSummaries,
  getConversationRecord,
  saveConversation,
  deleteConversation,
  saveConversationRuntimeContext,
  getConversationRuntimeContext,
  deleteConversationRuntimeContext,
  deleteConversationsByServer,
} = repository;

// 清理旧版本淘汰对话时遗留的运行上下文，只在首次加载时执行一次。
const removedOrphanContexts = repository.pruneOrphanRuntimeContexts();
if (removedOrphanContexts > 0) {
  writeAppLog({
    scope: "main.ai",
    message: "已清理遗留的 AI 对话运行上下文",
    data: { count: removedOrphanContexts },
  });
}
