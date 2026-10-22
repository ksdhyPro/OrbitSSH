import { vi } from "vitest";

import type {
  AiCommandCardEvent,
  AiStreamChunkEvent,
  AiStreamMessageStartEvent,
} from "../../../src/shared/ai";
import { defaultAppSettings } from "../../../src/shared/settings";

type Listener<T> = (event: T) => void;

/** 为渲染层测试构造 preload API 替身，并保留事件监听器以便模拟主进程推送。 */
export function installOrbitApiMock() {
  const listeners = {
    streamMessageStart: [] as Listener<AiStreamMessageStartEvent>[],
    streamChunk: [] as Listener<AiStreamChunkEvent>[],
    commandCard: [] as Listener<AiCommandCardEvent>[],
  };

  const subscribe = <T>(bucket: Listener<T>[]) =>
    vi.fn((listener: Listener<T>) => {
      bucket.push(listener);
      return () => {
        const index = bucket.indexOf(listener);
        if (index >= 0) bucket.splice(index, 1);
      };
    });

  const api = {
    ai: {
      chat: vi.fn(),
      cancel: vi.fn(async () => true),
      runApprovedCommand: vi.fn(),
      rejectCommandApproval: vi.fn(async () => true),
      conversations: {
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        delete: vi.fn(async () => true),
      },
      onStreamMessageStart: subscribe(listeners.streamMessageStart),
      onStreamChunk: subscribe(listeners.streamChunk),
      onCommandCard: subscribe(listeners.commandCard),
    },
    settings: {
      get: vi.fn(async () => structuredClone(defaultAppSettings)),
      save: vi.fn(async (settings: unknown) => settings),
    },
    logger: {
      write: vi.fn(async () => undefined),
    },
  };

  window.orbitSSH = api as unknown as Window["orbitSSH"];

  return {
    api,
    listenerCount: () =>
      listeners.streamMessageStart.length +
      listeners.streamChunk.length +
      listeners.commandCard.length,
    emitStreamMessageStart: (event: AiStreamMessageStartEvent) =>
      listeners.streamMessageStart.forEach(listener => listener(event)),
    emitStreamChunk: (event: AiStreamChunkEvent) =>
      listeners.streamChunk.forEach(listener => listener(event)),
    emitCommandCard: (event: AiCommandCardEvent) =>
      listeners.commandCard.forEach(listener => listener(event)),
  };
}

/** 创建可在测试中手动完成的 Promise，用于观察请求进行中的状态。 */
export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
