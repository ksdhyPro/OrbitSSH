import { renameSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

/** electron-store 实例中被缓存层使用的部分：store 的 getter 会同步读取并解析整个文件。 */
export interface BackingStore<T> {
  readonly path: string;
  readonly store: T;
}

export interface CachedStoreOptions {
  /** 大于 0 时合并该时间窗口内的多次修改并异步写盘；为 0 时每次修改同步写盘。 */
  writeDelayMs?: number;
  onWriteError?: (error: unknown) => void;
}

const cachedStores = new Set<CachedStore<object>>();

// 与 electron-store（conf）的序列化格式保持一致，升级前后文件可以互相读取。
function serialize(data: unknown): string {
  return JSON.stringify(data, undefined, "\t");
}

/**
 * electron-store 的每次 get 都会同步读取并解析整个 JSON 文件，set 会同步重写整个文件。
 * 该缓存层只在启动时读取一次，之后读操作直接访问内存，写操作按需合并为异步原子写入，
 * 避免大对话历史阻塞主进程中的 SSH 数据转发和 IPC。
 */
export class CachedStore<T extends object> {
  private data: T;
  private version = 0;
  private persistedVersion = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | undefined;

  constructor(
    private readonly backing: BackingStore<T>,
    private readonly options: CachedStoreOptions = {},
  ) {
    this.data = backing.store;
    cachedStores.add(this);
  }

  /** 返回深拷贝，调用方可以自由修改；适合体积较小的数据。 */
  get<K extends keyof T>(key: K): T[K] {
    return structuredClone(this.data[key]);
  }

  /** 保存深拷贝，之后调用方继续修改传入对象不会影响缓存。 */
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.write(key, structuredClone(value));
  }

  /**
   * 直接返回缓存中的对象，不做拷贝。调用方必须把返回值视为只读，
   * 修改时通过 write 提交新的对象（不可变更新），用于体积较大的数据。
   */
  read<K extends keyof T>(key: K): Readonly<T[K]> {
    return this.data[key];
  }

  /** 以不可变方式提交新值，调用方之后不得再修改该对象。 */
  write<K extends keyof T>(key: K, value: T[K]): void {
    this.data = { ...this.data, [key]: value };
    this.version += 1;
    this.schedulePersist();
  }

  /** 立即把尚未落盘的修改同步写入，用于应用退出前。 */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.persistedVersion === this.version) return;
    this.writeSnapshotSync(this.version, serialize(this.data));
  }

  /** 等待当前排队的异步写入完成，主要供测试使用。 */
  async whenIdle(): Promise<void> {
    while (this.timer || this.writing) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.writing ??= this.persistAsync();
      }
      await this.writing;
    }
  }

  private schedulePersist(): void {
    const delay = this.options.writeDelayMs ?? 0;
    if (delay <= 0) {
      this.flushSync();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.writing ??= this.persistAsync();
    }, delay);
  }

  private async persistAsync(): Promise<void> {
    try {
      while (this.persistedVersion !== this.version) {
        const snapshotVersion = this.version;
        const tempPath = `${this.backing.path}.${process.pid}.${snapshotVersion}.tmp`;
        await writeFile(tempPath, serialize(this.data), "utf8");
        // 写临时文件期间可能已同步落盘更新的版本，此时丢弃旧快照，避免覆盖新数据。
        if (this.persistedVersion >= snapshotVersion) {
          rmSync(tempPath, { force: true });
          continue;
        }
        renameSync(tempPath, this.backing.path);
        this.persistedVersion = snapshotVersion;
      }
    } catch (error) {
      this.options.onWriteError?.(error);
      // 写入失败时保留未落盘状态，下一次修改或退出前会重试。
    } finally {
      this.writing = undefined;
    }
  }

  private writeSnapshotSync(version: number, content: string): void {
    const tempPath = `${this.backing.path}.${process.pid}.sync.tmp`;
    try {
      writeFileSync(tempPath, content, "utf8");
      renameSync(tempPath, this.backing.path);
      this.persistedVersion = version;
    } catch (error) {
      rmSync(tempPath, { force: true });
      this.options.onWriteError?.(error);
      throw error;
    }
  }
}

/** 应用退出前同步写入所有缓存中尚未落盘的修改。 */
export function flushAllCachedStores(): void {
  for (const store of cachedStores) {
    try {
      store.flushSync();
    } catch {
      // 单个存储写入失败不影响其他存储继续落盘，错误已由 onWriteError 记录。
    }
  }
}
