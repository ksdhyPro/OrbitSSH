import Store from "electron-store";

import { CachedStore } from "./cached-store.js";

export type AiApiProtocol = "responses" | "chat_completions";

interface AiProtocolRecord {
  /** 已确认可用的接口协议。 */
  protocol?: AiApiProtocol;
  /** 已确认不支持 tool_choice 参数的协议。 */
  unsupportedToolChoice?: AiApiProtocol[];
  checkedAt: number;
}

interface AiProtocolStoreSchema {
  configs: Record<string, AiProtocolRecord>;
}

// 同一 Base URL 和模型的协议探测结果跨重启保留，避免每次启动都先请求一次不存在的 /responses。
const store = new CachedStore<AiProtocolStoreSchema>(
  new Store<AiProtocolStoreSchema>({
    name: "ai-protocols",
    defaults: { configs: {} },
  }),
);

function update(key: string, change: (record: AiProtocolRecord) => AiProtocolRecord): void {
  const configs = store.read("configs");
  store.write("configs", {
    ...configs,
    [key]: change({ ...(configs[key] ?? { checkedAt: 0 }) }),
  });
}

export function getRememberedProtocol(key: string): AiApiProtocol | undefined {
  return store.read("configs")[key]?.protocol;
}

export function rememberProtocol(key: string, protocol: AiApiProtocol): void {
  if (getRememberedProtocol(key) === protocol) return;
  update(key, record => ({ ...record, protocol, checkedAt: Date.now() }));
}

export function isToolChoiceUnsupported(key: string, protocol: AiApiProtocol): boolean {
  return store.read("configs")[key]?.unsupportedToolChoice?.includes(protocol) ?? false;
}

export function rememberToolChoiceUnsupported(key: string, protocol: AiApiProtocol): void {
  if (isToolChoiceUnsupported(key, protocol)) return;
  update(key, record => ({
    ...record,
    unsupportedToolChoice: [...(record.unsupportedToolChoice ?? []), protocol],
    checkedAt: Date.now(),
  }));
}
