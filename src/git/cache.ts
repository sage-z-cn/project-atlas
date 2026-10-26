export class GitCache {
  private store = new Map<string, { data: unknown; timestamp: number }>();

  // 失效纪元计数器：每次 invalidate 递增。getOrLoad 借助它判断
  // loader 执行期间是否发生过失效，失效后的结果不再落缓存。
  private epoch = 0;

  // 正在执行的 loader（getOrLoad）。同一 key 的并发调用共享同一个
  // promise，不重复执行 loader。仅存于执行期间：成功随 set 落缓存后清除，
  // 失败立即清除。
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(private ttlMs = 5000) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown): void {
    this.store.set(key, { data, timestamp: Date.now() });
  }

  /**
   * get + set 的合并形态，额外做 in-flight 去重：
   * - TTL 内有缓存 → 直接返回，不执行 loader（与手写 get/set 调用点等价）；
   * - 同一 key 的 loader 正在执行 → 返回同一个 in-flight promise，
   *   同一事件窗口内的并发调用方合并为一次执行；
   * - 成功 → 按现有 TTL 写入 store，并清除 in-flight 条目；
   * - 失败 → 只清除 in-flight 条目并向上抛错：失败结果不落缓存，
   *   后续调用会重新执行 loader，不会被失败状态卡死。
   *
   * invalidate 不动 in-flight，但会递增 epoch：若 loader 执行期间发生过
   * 失效，其结果可能是失效前的旧快照，resolve 后不写入 store，失效之后
   * 的调用方自然会重新加载；当前等待者仍共享同一结果，去重保持不变。
   */
  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending as Promise<T>;
    }
    const epochAtStart = this.epoch;
    const promise = (async () => {
      try {
        const data = await loader();
        if (this.epoch === epochAtStart) {
          this.set(key, data);
        }
        return data;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      this.epoch++;
      return;
    }
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
    // 即使没有匹配 key 也递增：语义是"发生过失效"。
    this.epoch++;
  }
}
