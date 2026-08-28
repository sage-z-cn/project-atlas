import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";
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

  // whenReady: 首批 initRepo/getRepos 请求可能与首次扫描竞态（setupGit 不 await
  // registry.init），手写 handler 需自行兜底，避免读到空仓库列表。
  messageRouter.handle("getRepos", async () => {
    await registry.whenReady;
    return { repos: registry.getRepoInfos() };
  });

  messageRouter.handle("getCurrentRepo", async () => {
    await registry.whenReady;
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
    await registry.whenReady; // setCurrent 校验 services.has()，需首次扫描完成后再切换
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
  //
  // In-flight merge: panel 和 commit 两个 webview 会在同一事件窗口内各自
  // 请求一次 getRepoStatuses，每次都要对每个 repo 跑 git 子进程。这里把
  // 并发相同请求合并为一次执行，共享同一个 Promise。批执行期间若又有新
  // 请求到达（变更后事件触发，最早 ~700ms 后到达），可能加入的是变更前
  // 启动、仍在跑的旧批次——批后补跑一轮（while requestedDuringFlight），
  // 所有共享该 Promise 的调用方最终拿到最新一轮结果。刻意不加 TTL——
  // 正确性依赖 watcher「先 invalidate 后广播」的顺序，TTL 会在广播后
  // 返回旧值。
  let inFlight: Promise<unknown> | null = null;
  let requestedDuringFlight = false;
  // 原批次执行体：全量拉取每个 repo 的 ahead/behind/dirty/branch。
  const runBatch = async () => {
    await registry.whenReady;
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
            // noCache: ahead/behind 徽章必须实时反映外部进程的提交。git 更
            // 新 refs 走 lockfile + 原子 rename,FS watcher 可能漏报,若读
            // 5s TTL 缓存会返回旧计数,故 getBranches 需 noCache 绕过。
            // getWorkingTreeChanges 自带 1.5s 短 TTL 缓存(statusCache),
            // 可吸收本批次的重复调用,无需绕过。结果仍写回缓存,其他调用
            // 方继续受益。
            svc.getBranches({ noCache: true }),
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
  };
  messageRouter.handle("getRepoStatuses", () => {
    if (inFlight) {
      requestedDuringFlight = true;
      return inFlight;
    }
    inFlight = (async () => {
      let result = await runBatch();
      // 批执行期间有新请求到达（可能携带变更后状态）→ 补跑一轮，
      // 所有共享该 Promise 的调用方最终拿到最新一轮结果。
      while (requestedDuringFlight) {
        requestedDuringFlight = false;
        result = await runBatch();
      }
      return result;
    })();
    inFlight.finally(() => {
      inFlight = null;
    });
    return inFlight;
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

  // ── Multi-repo batch operations (every repo, not just the active one) ──
  // 两个 handler 都是多仓库维度操作，requireGit 只解析"当前仓库"，不适用，
  // 直接基于 ctx.registry 手写（与 refreshGitState 同类，自行兜底竞态）。
  // 核心逻辑在 refreshAllReposImpl / pullAllReposImpl 中，同时供 VSCode
  // 命令层（gitCommands.ts 的 git-atlas.refreshAllRepos / pullAllRepos，
  // 挂 commitPanel view/title 工具栏）复用。

  // 多仓库版 refreshGitState：rescan 工作区根（识别外部 git init / 新增仓库）
  // 后对 registry 中每个仓库 invalidateCache，再广播全局 gitStateChanged。
  messageRouter.handle("refreshAllRepos", () => refreshAllReposImpl(ctx));

  // 逐仓库 pull 当前分支（--autostash），返回 { pulled, skipped, failed }。
  messageRouter.handle("pullAllRepos", () => pullAllReposImpl(ctx));
}

/**
 * Core implementation of the multi-repo "refresh all" operation, shared by the
 * `refreshAllRepos` webview handler and the `git-atlas.refreshAllRepos`
 * view/title command. Semantics mirror refreshGitState, applied to every
 * repo in the registry instead of only the active one.
 */
export async function refreshAllReposImpl(
  ctx: GitHandlerContext,
): Promise<{ success: true }> {
  const { registry, messageRouter } = ctx;
  await registry.whenReady; // 手写 handler 自行兜底首批请求竞态
  const roots = (vscode.workspace.workspaceFolders ?? []).map(
    (f) => f.uri.fsPath,
  );
  await registry.rescan(roots); // 识别外部 git init / 新增仓库
  for (const svc of registry.getAll()) {
    svc.invalidateCache();
  }
  messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
  return { success: true };
}

/** Per-repo failure entry returned by {@link pullAllReposImpl}. */
export interface PullAllReposFailure {
  repoPath: string;
  name: string;
  error: string;
}

/** Result shape of {@link pullAllReposImpl} (pulled/skipped hold repoPath). */
export interface PullAllReposResult {
  success: true;
  pulled: string[];
  skipped: string[];
  failed: PullAllReposFailure[];
}

/**
 * Core implementation of the multi-repo "pull all" operation, shared by the
 * `pullAllRepos` webview handler and the `git-atlas.pullAllRepos` view/title
 * command. Pulls the current branch (--autostash) of every repo, strictly
 * serially: concurrent pulls would spawn a batch of git processes at once,
 * contend for the network / trip remote rate limits, and make it harder to
 * attribute failures to a single repo.
 *
 * Repos without a remote, or whose current branch has no upstream yet
 * (freshly created branch never pushed, detached HEAD), are recorded in
 * `skipped`; a single repo failure (network / conflict / auth / ...) never
 * aborts the batch — it is recorded in `failed`. Afterwards every repo's
 * cache is invalidated and one global gitStateChanged is broadcast so all
 * webview views refresh.
 */
// 批量 pull 进行中标志：重复触发（连点工具栏按钮）时直接返回空结果，
// 避免两个批次对同一仓库并发 git pull 争抢 index.lock 产生假失败。
let pullAllInProgress = false;

export async function pullAllReposImpl(
  ctx: GitHandlerContext,
): Promise<PullAllReposResult> {
  const { registry, messageRouter } = ctx;
  if (pullAllInProgress) {
    return { success: true as const, pulled: [], skipped: [], failed: [] };
  }
  pullAllInProgress = true;
  try {
    return await withProgress(ctx, async () => {
      await registry.whenReady;
      const nameByPath = new Map(
        registry.getRepoInfos().map((info) => [info.path, info.name] as const),
      );
      const pulled: string[] = [];
      const skipped: string[] = [];
      const failed: PullAllReposFailure[] = [];
      for (const svc of registry.getAll()) {
        try {
          if (!(await svc.hasRemote())) {
            skipped.push(svc.cwd);
            continue;
          }
          // 有 remote 但当前分支无 upstream（新建分支未 push -u；detached
          // HEAD 的伪分支名以 "(" 开头）时 git pull 必然报 "no tracking
          // information"，提前归入 skipped 而非误报 failed。getBranches 有
          // 5s 缓存，批量场景下开销可忽略。
          const cur = (await svc.getBranches()).find((b) => b.isCurrent);
          if (!cur || !cur.upstream || cur.name.startsWith("(")) {
            skipped.push(svc.cwd);
            continue;
          }
          await svc.pull(); // 成功时 pull 内部已自行 invalidateCache
          pulled.push(svc.cwd);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          failed.push({
            repoPath: svc.cwd,
            name: nameByPath.get(svc.cwd) ?? svc.cwd,
            error,
          });
          console.error(
            `[Git Atlas] pullAllRepos: pull failed for ${svc.cwd}:`,
            error,
          );
        }
      }
      // 兜底清缓存：skipped/failed 仓库没走 pull 内部的 invalidateCache。
      for (const svc of registry.getAll()) {
        svc.invalidateCache();
      }
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true as const, pulled, skipped, failed };
    });
  } finally {
    pullAllInProgress = false;
  }
}
