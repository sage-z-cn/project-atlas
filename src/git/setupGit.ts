import * as vscode from "vscode";
import { MessageRouter } from "../messages/messageRouter";
import { GitService } from "./gitService";
import { RepoRegistry } from "./repoRegistry";
import { normalizePath } from "./repoPaths";
import { ReactViewProvider } from "../webview/reactViewProvider";
import {
  GIT_ATLAS_SCHEME,
  GitContentProvider,
} from "../webview/gitContentProvider";
import { DiffEditorManager } from "../webview/diffEditorManager";
import { MergeEditorManager } from "../webview/mergeEditorManager";
import { ConflictsManager } from "../webview/conflictsManager";
import { PushPanel } from "../webview/pushPanel";
import { RollbackPanel } from "../webview/rollbackPanel";
import { registerGitHandlers } from "../commands/gitHandlers";
import { registerReleaseHandlers } from "../commands/gitHandlers/releaseHandlers";
import { registerGitCommands } from "../commands/gitCommands";
import { registerAiCommands } from "../commands/aiCommands";
import { registerCommitViewBadge } from "./commitViewBadge";
import { BlameHoverProvider } from "./blameHoverProvider";
import type { GitHandlerContext } from "../commands/gitContext";

/**
 * Git Atlas 模块化装配入口。
 *
 * 把所有 git 相关的 Service / Manager / Provider / Watcher / 命令 / 状态栏
 * 装配集中在一个函数里，与 Project Atlas 现有的装配逻辑完全解耦。
 * extension.ts 的 activate() 只需在末尾调用一次 setupGit(context)。
 *
 * 多 repo（阶段 A）：RepoRegistry 负责扫描 workspace 根 + 1 层子目录的
 * git 仓库，为每个 repo 创建独立的 GitService + GitWatcher，并维护一个
 * "当前 repo"。panel / commit / diff editor 通过 ctx.gitService（= registry
 * .getCurrent() 的 getter 别名）共享当前 repo。
 *
 * 装配顺序（启动延迟优化后的时序）：
 *   a. MessageRouter 单例（所有 webview 共享）
 *   b. workspace roots → RepoRegistry 创建 → GitContentProvider /
 *      DiffEditorManager 同步注册（绑定到 registry，不依赖 init 完成）
 *   c. 后台发起 RepoRegistry.init（不 await：扫盘 + service/watcher 创建
 *      在后台进行，不阻塞下方装配；早到的 webview 请求由 handler 内的
 *      `await registry.whenReady` 兜底）
 *   d. Manager / Panel 实例（merge / conflicts / push / rollback）
 *   e. 构造 GitHandlerContext（registry + getter 形式的 gitService）
 *   f. 注册 handler（MessageRouter）+ command（VSCode commands）
 *   g. 注册 ReactViewProvider × 2（gitLog / commitPanel）——必须在 handler
 *      之后：provider 可被 resolve 时所有 handler 已就绪，webview 首批
 *      请求不会打到未注册的 command
 *   h. 状态栏项 / badge / hover / 监听器等其余装配
 *   i. 全部 disposable push 到 context.subscriptions（随注册时机就地 push）
 */
export async function setupGit(context: vscode.ExtensionContext): Promise<void> {
  // a. MessageRouter 单例（所有 webview 共享）
  const messageRouter = new MessageRouter();

  // b. 处理 workspace folders → RepoRegistry
  const allWorkspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(
    (f) => f.uri.fsPath,
  );
  const workspaceRoot = allWorkspaceRoots[0];

  // Single-slot stash for a focus-commit request that lands before the Git Log
  // webview is mounted (the first blame-link click opens the panel, so its
  // focusCommit broadcast has no listener yet). The webview drains it via the
  // consumePendingFocus request on initRepo.
  const pendingFocus: { hash: string | null } = { hash: null };

  // RepoRegistry 内部为每个 repo 创建 GitService + GitWatcher，
  // setupGit 不再手动遍历创建 service / watcher。
  const registry = new RepoRegistry(messageRouter, context);

  // c. GitContentProvider / DiffEditorManager
  //
  // provider 必须在 registry.init() 之前、无条件同步注册：两者都持有
  // RepoRegistry（而非启动时的单一 GitService 快照），内容读取按 git-atlas
  // URI 中的 repo 参数（或当前 repo）动态解析，切换/多 repo 场景下虚拟文档
  // 始终命中正确的仓库。
  //
  // 关键：窗口重启恢复 git-atlas: diff 编辑器时，编辑器恢复走 FileSystem
  // 路径，FileService.withProvider 会通过 onWillActivateFileSystemProvider
  // 钩子触发 activateByEvent('onFileSystem:git-atlas') 并 join 等待扩展激活
  // （package.json 已显式声明该激活事件——注意 contributes.fileSystemProviders
  // 并不会自动生成它，见 vscode#164701；不声明则 activateByEvent 命中失败、
  // joiner 空 resolve，provider 仍缺失 → 报"无法打开编辑器"，见 vscode#48665）。
  // 激活触发后：activate 是同步函数、setupGit 以 void 调用，执行到下方
  // registerFileSystemProvider 时同步完成，activate 返回即 provider 就绪，
  // joiner 的 promise 随之 resolve，恢复链路继续读取。注意 provider 注册不能
  // 依赖 getCurrent()（init 未完成时为空也不能跳过），provider 自身在 repo 未
  // 就绪时返回空内容、不会抛错，待 init 完成、repo 就绪后内容即可正常读取。
  const contentProvider = new GitContentProvider(registry);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_ATLAS_SCHEME,
      contentProvider,
    ),
    vscode.workspace.registerFileSystemProvider(
      GIT_ATLAS_SCHEME,
      contentProvider,
      { isReadonly: true },
    ),
  );

  const diffManager = new DiffEditorManager(registry);

  // c. 后台发起 RepoRegistry.init（首次扫描，不阻塞装配）
  //
  //    关键时序：不 await，扫盘 + service/watcher 创建在后台进行，让下方
  //    managers / ctx / handler / provider 注册全部同步推进，消除
  //    "provider 未注册导致 VSCode 无法 resolve 视图"的启动阻塞。
  //    早到的 webview 首批请求由各 handler 内的 `await registry.whenReady`
  //    兜底（见 gitContext.requireGit 与各手写 handler）；init 完成 / 仓库
  //    变化时 rescan 广播 reposChanged 驱动已挂载的 webview 刷新。
  void registry.init(allWorkspaceRoots);
  context.subscriptions.push(registry);

  // e. 创建 Manager / Panel 实例（按各自构造签名）
  const mergeManager = new MergeEditorManager(
    context.extensionUri,
    messageRouter,
  );
  const conflictsManager = new ConflictsManager(
    context.extensionUri,
    messageRouter,
  );
  const pushPanel = new PushPanel(context.extensionUri, messageRouter);
  const rollbackPanel = new RollbackPanel(context.extensionUri, messageRouter);

  // f. 构造 GitHandlerContext（共享给所有 handler 注册函数）
  //
  //    gitService 用 getter 形式：始终返回 registry.getCurrent()，这样
  //    切换 repo 后所有读取 ctx.gitService 的 handler 自动跟随。
  const ctx: GitHandlerContext = {
    messageRouter,
    context,
    registry,
    get gitService() {
      return registry.getCurrent();
    },
    diffManager,
    mergeManager,
    conflictsManager,
    pushPanel,
    rollbackPanel,
    workspaceRoot,
    pendingFocus,
  };

  // g. 注册 handler（MessageRouter）和 command（VSCode commands）
  registerGitHandlers(ctx);
  registerReleaseHandlers(ctx);

  // h. 注册 WebviewViewProvider（必须在 handler 之后）
  //    gitLog → panel 模式；commitPanel → commit 模式
  //
  //    时序关键：provider 注册后 VSCode 即可 resolve 视图并挂载 webview，
  //    webview 首批请求会立刻发出。放在 registerGitHandlers 之后保证
  //    provider 可被 resolve 时所有 handler 已注册，消除早到请求打到
  //    未注册 command 的窗口；registry 侧的竞态由 handler 内 whenReady
  //    兜底。
  const logProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "panel",
    "Git Atlas",
  );
  const commitProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "commit",
    "Git Atlas",
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "git-atlas.gitLog",
      logProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      "git-atlas.commitPanel",
      commitProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // 配置变更监听：gitAtlas.* 配置变化时通知 webview 热刷新
  // （面板显隐由 package.json when 子句的 config.* 键原生驱动，无需 setContext）
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitAtlas")) {
        messageRouter.broadcastEvent("gitConfigChanged", {});
      }
    }),
  );

  // 窗口聚焦 → 广播 commitStateChanged，触发 commit 面板重扫 working tree。
  // webview 内部的 visibilitychange / window.focus 在窗口从外部应用切回时
  // 不可靠（iframe 焦点行为依赖宿主），这里从扩展端补一个可靠信号；与
  // setupProject 的 dataChanged 广播模式对齐。
  //
  // 节流（leading + trailing, 5s）：commitStateChanged 会让 commit-store
  // 调 fetchRepoStatuses()，对所有注册 repo 各跑一次 git status（badge 显示
  // 需要）。多 repo 用户频繁 alt-tab 会累积开销。leading 保证首次切回立即
  // 刷新，trailing 确保阈值内的最后一次切回信号不丢失。webview 端的
  // fetchChanges/fetchStashes 有 seq 竞态保护，多次广播不会出错。
  const FOCUS_THROTTLE_MS = 5000;
  let lastFocusBroadcastAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | undefined;
  const broadcastCommitChanged = () => {
    messageRouter.broadcastEvent("commitStateChanged", {});
    lastFocusBroadcastAt = Date.now();
  };
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (!e.focused) return;
      const elapsed = Date.now() - lastFocusBroadcastAt;
      if (elapsed >= FOCUS_THROTTLE_MS) {
        broadcastCommitChanged();
        return;
      }
      // 阈值内：安排一次尾部补刷（多次触发共享同一个 timer），确保最后
      // 一次切回引入的外部变更不会被吞掉。
      if (!trailingTimer) {
        trailingTimer = setTimeout(
          () => {
            trailingTimer = undefined;
            broadcastCommitChanged();
          },
          FOCUS_THROTTLE_MS - elapsed,
        );
      }
    }),
    { dispose: () => {
      if (trailingTimer) clearTimeout(trailingTimer);
    } },
  );

  // 工作区目录变化 / `.git` 目录创建 → 防抖重扫,识别外部 `git init` 或新增仓库。
  // 多个触发源(workspace folder 变化、.git 目录创建)汇聚到一次 rescan,避免
  // 短时间内重复扫盘。rescan 内部在仓库列表变化时广播 reposChanged,前端据此
  // 刷新仓库选择器;未变化时不广播,无副作用。
  let rescanTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRescan = (): void => {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescanTimer = undefined;
      const roots = (vscode.workspace.workspaceFolders ?? []).map(
        (f) => f.uri.fsPath,
      );
      void registry.rescan(roots); // rescan 内部在列表变化时广播 reposChanged
    }, 800);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => scheduleRescan()),
    (() => {
      // 监听 .git 目录创建:用户在外部执行 `git init` 时触发自动重扫。
      // `**/.git` 匹配任意层级的 .git 目录(含 submodule),onDidCreate 只在
      // 目录首次创建时触发,不关心后续内容修改,开销可控。
      const watcher = vscode.workspace.createFileSystemWatcher("**/.git");
      const sub = watcher.onDidCreate(() => scheduleRescan());
      return { dispose: () => {
        sub.dispose();
        watcher.dispose();
      } };
    })(),
    { dispose: () => {
      if (rescanTimer) clearTimeout(rescanTimer);
    } },
  );

  registerGitCommands(context, ctx);

  // Hover provider: appends a "Locate in Git Atlas" link to the editor hover
  // for every line inside a known git repo (next to VSCode's built-in blame).
  // See src/git/blameHoverProvider.ts.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      new BlameHoverProvider(registry),
    ),
  );

  registerAiCommands(ctx);

  // h. 临时调试命令（不进 package.json contributes，仅内部 registerCommand
  //    用于阶段 A 手测后端联动）
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "git-atlas._debugSwitchRepo",
      async () => {
        await registry.whenReady;
        const repos = registry.getRepoInfos();
        if (repos.length === 0) {
          void vscode.window.showWarningMessage("No repos found");
          return;
        }
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({
            label: r.name,
            description: r.path,
            picked: r.path === registry.getCurrentRepoPath(),
          })),
          { placeHolder: "Switch current repo" },
        );
        if (pick?.description) {
          await registry.setCurrent(pick.description);
        }
      },
    ),
  );

  // i. 状态栏项
  //
  //    对齐 VSCode 原生 git 状态栏：显示分支名 / ahead↑（未推送 commit）/
  //    behind↓（落后 commit）/ 工作树改动数 ●N。多 repo 工作区时前缀显示
  //    当前 repo 名。点击弹出 VSCode 原生 `git.checkout` quick pick，并尽
  //    可能精确作用于当前 repo（通过 vscode.git 导出 API 的 Repository）。
  context.subscriptions.push(
    registerGitStatusBar(registry),
  );

  // j. Commit 视图活动栏徽标（activity bar 上的更改数量 badge）
  //    受 gitAtlas.commitBadgeMode 控制：total / current / off
  context.subscriptions.push(registerCommitViewBadge(registry));
}

// ─── vscode.git 导出 API 最小类型（避免引入 @types/vscode-git） ──────────
type VscodeGitApi = {
  repositories: { rootUri: vscode.Uri }[];
};
type VscodeGitExports = { getAPI(version: 1): VscodeGitApi };

/**
 * Resolve the `vscode.git` built-in extension's API, activating it if needed.
 * Returns undefined when the extension is unavailable (e.g. user disabled it).
 */
async function getVscodeGitApi(): Promise<VscodeGitApi | undefined> {
  try {
    const gitExt =
      vscode.extensions.getExtension<VscodeGitExports>("vscode.git");
    if (!gitExt) return undefined;
    if (!gitExt.isActive) await gitExt.activate();
    return gitExt.exports.getAPI(1);
  } catch {
    return undefined;
  }
}

/**
 * Build and register the Git Atlas status bar item.
 *
 * Display mirrors VSCode's built-in git status bar (branch + ahead/behind +
 * working-tree changes) aggregated into one item, prefixed with the repo name
 * when the workspace has multiple repos. Clicking triggers the native
 * `git.checkout` quick pick, scoped to the current repo via vscode.git's API
 * (the extension's `getOpenRepository` accepts an ApiRepository / Uri and
 * resolves the owning repository).
 */
function registerGitStatusBar(
  registry: RepoRegistry,
): vscode.Disposable {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  // Debounce consecutive git-state events into a single refresh, and avoid
  // reentrant refreshes: while one is in flight, coalesce further events into
  // a pending flag that triggers one more refresh after the current finishes.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshing = false;
  let pendingRefresh = false;

  const scheduleRefresh = (): void => {
    if (refreshing) {
      pendingRefresh = true;
      return;
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshStatusBar();
    }, 200);
  };

  async function refreshStatusBar(): Promise<void> {
    refreshing = true;
    try {
      const svc = registry.getCurrent();
      const repoPath = registry.getCurrentRepoPath();
      const infos = registry.getRepoInfos();
      const multiRepo = infos.length > 1;
      const currentInfo = repoPath
        ? infos.find((i) => i.path === repoPath)
        : undefined;

      if (!svc || !repoPath) {
        statusBarItem.text = "$(git-branch) Git Atlas";
        statusBarItem.tooltip = vscode.l10n.t("Git Atlas (no repository)");
        statusBarItem.command = "git-atlas._statusBarCheckout";
        void vscode.commands.executeCommand(
          "setContext",
          "gitAtlas.hasConflicts",
          false,
        );
        return;
      }

      // Branch / upstream / ahead / behind — from getBranches() (cached 5s).
      let branch = "";
      let isDetached = false;
      let hasUpstream = false;
      let ahead = 0;
      let behind = 0;
      try {
        const branches = await svc.getBranches();
        const cur = branches.find((b) => b.isCurrent);
        if (cur && cur.name && !cur.name.startsWith("(")) {
          branch = cur.name;
          hasUpstream = !!cur.upstream;
          ahead = cur.ahead ?? 0;
          behind = cur.behind ?? 0;
        } else {
          // Detached HEAD (git reports a "(HEAD detached at <hash>)" pseudo-branch).
          isDetached = true;
          branch = "detached";
        }
      } catch {
        branch = "?";
      }

      // Working-tree changes count (modified + staged + untracked).
      let dirty = 0;
      let hasConflicts = false;
      try {
        const changes = await svc.getWorkingTreeChanges();
        dirty = changes.length;
        hasConflicts = changes.some((f) => f.status === "conflicted");
      } catch {
        // ignore — leave dirty at 0
      }
      // Drive the log-panel "Conflicts" toolbar button visibility (current repo).
      void vscode.commands.executeCommand(
        "setContext",
        "gitAtlas.hasConflicts",
        hasConflicts,
      );

      // Icon: changes → git-branch-changes, detached → git-commit, else git-branch.
      // Matches VSCode built-in git's per-state branch icon selection.
      const icon = isDetached
        ? "$(git-commit)"
        : dirty > 0
          ? "$(git-branch-changes)"
          : "$(git-branch)";

      const parts: string[] = [];
      if (multiRepo && currentInfo) {
        parts.push(`$(repo) ${currentInfo.name}`);
      }
      parts.push(`${icon} ${branch}`);
      // Only render ahead/behind when an upstream exists; 0 counts are omitted
      // to keep the item compact (VSCode's sync item shows 0s, but aggregation
      // here favours signal over completeness).
      if (hasUpstream && behind > 0) parts.push(`↓${behind}`);
      if (hasUpstream && ahead > 0) parts.push(`↑${ahead}`);
      if (dirty > 0) parts.push(`●${dirty}`);

      statusBarItem.text = parts.join(" ");

      const tipLines: string[] = [];
      if (currentInfo) {
        tipLines.push(vscode.l10n.t("Repo: {0}", currentInfo.path));
      }
      tipLines.push(vscode.l10n.t("Branch: {0}", branch));
      if (hasUpstream) {
        tipLines.push(
          vscode.l10n.t(
            "↑ {0} ahead   ↓ {1} behind",
            String(ahead),
            String(behind),
          ),
        );
      } else if (!isDetached) {
        tipLines.push(vscode.l10n.t("Branch has no upstream"));
      }
      tipLines.push(
        vscode.l10n.t("{0} working-tree change(s)", String(dirty)),
      );
      tipLines.push("");
      tipLines.push(vscode.l10n.t("Click to checkout a branch/tag"));
      statusBarItem.tooltip = tipLines.join("\n");

      // Click handler is resolved at click time (repo may have switched), so a
      // fixed command string is enough.
      statusBarItem.command = "git-atlas._statusBarCheckout";
    } finally {
      refreshing = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        scheduleRefresh();
      }
    }
  }

  /**
   * Status-bar click: open VSCode's native `git.checkout` quick pick, scoped to
   * the current repo. Tries, in order: (1) the matching Repository from
   * vscode.git's API — `git.checkout`'s repository resolver unpacks ApiRepository
   * via rootUri; (2) fall back to a Uri argument (longest-prefix match); (3) a
   * bare `git.checkout` that lets VSCode prompt for the repository.
   */
  async function onStatusBarClick(): Promise<void> {
    // whenReady: provider 提前后状态栏随激活早期出现，首次扫描完成前点击
    // 也要解析到正确 repo（getCurrentRepoPath 依赖 init 恢复的当前仓库）。
    await registry.whenReady;
    const repoPath = registry.getCurrentRepoPath();
    try {
      const api = await getVscodeGitApi();
      let target: unknown;
      if (api && repoPath) {
        target = api.repositories.find(
          (r) => normalizePath(r.rootUri.fsPath) === repoPath,
        );
      }
      if (!target && repoPath) {
        target = vscode.Uri.file(repoPath);
      }
      if (target !== undefined) {
        await vscode.commands.executeCommand("git.checkout", target);
      } else {
        await vscode.commands.executeCommand("git.checkout");
      }
    } catch {
      // git extension unavailable or checkout failed — degrade to bare command.
      try {
        await vscode.commands.executeCommand("git.checkout");
      } catch {
        // truly unavailable; nothing more to do
      }
    }
  }

  statusBarItem.text = "$(git-branch) Git Atlas";
  statusBarItem.tooltip = "Git Atlas";
  statusBarItem.show();

  const subscriptions: vscode.Disposable[] = [
    statusBarItem,
    vscode.commands.registerCommand("git-atlas._statusBarCheckout", () =>
      void onStatusBarClick(),
    ),
    registry.onGitStateChanged(() => scheduleRefresh()),
  ];

  // Initial render.
  void refreshStatusBar();

  return vscode.Disposable.from(...subscriptions);
}
