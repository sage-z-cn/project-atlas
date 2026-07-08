import type { GitHandlerContext } from "../gitContext";

/**
 * Multi-repo management handlers: listing repos, querying the active repo,
 * and switching the active repo.
 *
 * These back the panel/commit repo switcher added in phase A. They are
 * intentionally thin wrappers over RepoRegistry so all normalization and
 * persistence logic stays centralized there.
 */
export function registerRepoHandlers(ctx: GitHandlerContext): void {
  const { messageRouter, registry } = ctx;

  messageRouter.handle("getRepos", async () => {
    return { repos: registry.getRepoInfos() };
  });

  messageRouter.handle("getCurrentRepo", async () => {
    return { repoPath: registry.getCurrentRepoPath() };
  });

  messageRouter.handle("switchRepo", async (params) => {
    const repoPath = params?.repoPath as string | undefined;
    if (repoPath) {
      await registry.setCurrent(repoPath);
    }
    return { ok: true, repoPath: registry.getCurrentRepoPath() };
  });

  // ── Per-repo status badges (RepoSelector ↑/↓/● counts) ───────────────
  // Fetches the ahead/behind/dirty counts for EVERY known repo in parallel so
  // the chip strip can render all badges from a single round-trip. Each repo
  // is independently try/caught so a single broken repo (no commits yet, git
  // failure, detached HEAD) never aborts the whole batch — it just reports
  // null ahead/behind + dirty 0 for that one repo.
  messageRouter.handle("getRepoStatuses", async () => {
    const infos = registry.getRepoInfos();
    const statuses = await Promise.all(
      infos.map(async (info) => {
        const svc = registry.getService(info.path);
        if (!svc) {
          return {
            repoPath: info.path,
            ahead: null,
            behind: null,
            dirty: 0,
          };
        }
        try {
          const [branches, changes] = await Promise.all([
            svc.getBranches(),
            svc.getWorkingTreeChanges(),
          ]);
          const current = (branches ?? []).find((b) => b.isCurrent);
          // BranchInfo.upstream is optional: when undefined/empty the branch
          // has no upstream tracking ref, so ahead/behind are meaningless →
          // report null (the chip hides ↑/↓). ahead/behind being 0 alone is
          // NOT a reliable "no upstream" signal (they're just 0 when in sync).
          const hasUpstream = !!current?.upstream;
          return {
            repoPath: info.path,
            ahead: hasUpstream ? current?.ahead ?? 0 : null,
            behind: hasUpstream ? current?.behind ?? 0 : null,
            // getWorkingTreeChanges runs `git status --porcelain -uall`, so
            // this already includes modified + staged + untracked files.
            dirty: changes.length,
          };
        } catch {
          return {
            repoPath: info.path,
            ahead: null,
            behind: null,
            dirty: 0,
          };
        }
      }),
    );
    return { statuses };
  });
}
