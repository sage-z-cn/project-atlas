import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit } from "../gitContext";
import { initGitRepo } from "../../git/gitService";
import { normalizePath } from "../../git/repoPaths";

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

  // 当前仓库是否配置了远程（`git remote` 非空）。用于在 UI 层禁用"提交并推送"
  // 按钮（第一道门槛），避免无 remote 时仍允许触发推送流程。
  messageRouter.handle(
    "hasRemote",
    requireGit(ctx, async (gitService) => {
      return { hasRemote: await gitService.hasRemote() };
    }),
  );

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
            branch: null,
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
            branch: current?.name ?? null,
          };
        } catch {
          return {
            repoPath: info.path,
            ahead: null,
            behind: null,
            dirty: 0,
            branch: null,
          };
        }
      }),
    );
    return { statuses };
  });

  // 在工作区非 git 目录(或指定目录)执行 `git init`。
  // 目标目录此时还不是 git 仓库、没有 GitService 实例,因此调用独立的导出函数。
  // rescan 内部会在仓库列表变化时广播 reposChanged,前端据此刷新仓库选择器。
  messageRouter.handle("initializeRepository", async (params) => {
    const explicit =
      typeof params?.repoPath === "string" ? params.repoPath : undefined;
    const targetPath =
      explicit ??
      (vscode.workspace.workspaceFolders ?? [])[0]?.uri.fsPath ??
      ctx.workspaceRoot;
    if (!targetPath) {
      return { success: false as const, error: "No workspace folder available" };
    }
    try {
      await initGitRepo(targetPath);
      const roots = (vscode.workspace.workspaceFolders ?? []).map(
        (f) => f.uri.fsPath,
      );
      await ctx.registry.rescan(roots); // rescan 内部会在列表变化时广播 reposChanged
      return { success: true as const, repoPath: normalizePath(targetPath) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false as const, error: message };
    }
  });
}
