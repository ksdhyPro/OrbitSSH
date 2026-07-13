interface StoredApproval<T> {
  value: T;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  onExpire?: (id: string, value: T) => void;
}

export interface RemovedApproval<T> {
  id: string;
  value: T;
}

/** 管理审批 TTL 与按标签页清理，确保审批只能被取出一次。 */
export class ExpiringApprovalStore<T extends { tabId: string }> {
  private readonly approvals = new Map<string, StoredApproval<T>>();

  set(
    id: string,
    value: T,
    ttlMs: number,
    onExpire?: (id: string, value: T) => void,
  ): void {
    this.delete(id);
    const expiresAt = Date.now() + ttlMs;
    const timer = setTimeout(() => {
      const stored = this.approvals.get(id);
      if (!stored) return;
      this.approvals.delete(id);
      stored.onExpire?.(id, stored.value);
    }, ttlMs);
    timer.unref();
    this.approvals.set(id, { value, expiresAt, timer, onExpire });
  }

  get(id: string): T | null {
    const stored = this.approvals.get(id);
    if (!stored) return null;
    if (Date.now() >= stored.expiresAt) {
      clearTimeout(stored.timer);
      this.approvals.delete(id);
      stored.onExpire?.(id, stored.value);
      return null;
    }
    return stored.value;
  }

  take(id: string): T | null {
    const value = this.get(id);
    if (!value) return null;
    this.delete(id);
    return value;
  }

  delete(id: string): boolean {
    const stored = this.approvals.get(id);
    if (!stored) return false;
    clearTimeout(stored.timer);
    return this.approvals.delete(id);
  }

  clearForTab(tabId: string): RemovedApproval<T>[] {
    const removed: RemovedApproval<T>[] = [];
    for (const [id, stored] of this.approvals) {
      if (stored.value.tabId !== tabId) continue;
      clearTimeout(stored.timer);
      this.approvals.delete(id);
      removed.push({ id, value: stored.value });
    }
    return removed;
  }
}
