import type { RepoInfo } from "../types/git";

/**
 * 按 incoming 的顺序本地重排 current（纯内存操作，不发任何请求）：
 * - 优先保留 current 中已有的对象引用（衍生状态均按 path 键控，保引用
 *   只为避免无意义的对象重建）；
 * - incoming 中多出的仓库（current 尚未见过）直接采用；
 * - current 中多出的仓库（广播方还不知道）保持原相对顺序追加尾部。
 *
 * 供两处共用：reposChanged 事件携带 repos 的纯重排信号（panel/commit
 * store 免全量刷新），以及 persistRepoOrder 对 setRepoOrder 响应的回填。
 */
export function applyRepoOrder(
  current: RepoInfo[],
  incoming: RepoInfo[],
): RepoInfo[] {
  const byPath = new Map(current.map((r) => [r.path, r]));
  const next: RepoInfo[] = [];
  const seen = new Set<string>();
  for (const r of incoming) {
    if (!r || typeof r.path !== "string" || seen.has(r.path)) continue;
    next.push(byPath.get(r.path) ?? r);
    seen.add(r.path);
  }
  for (const r of current) {
    if (!seen.has(r.path)) {
      next.push(r);
      seen.add(r.path);
    }
  }
  return next;
}
