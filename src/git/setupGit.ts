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
import { registerGitCommands } from "../commands/gitCommands";
import { registerCommitViewBadge } from "./commitViewBadge";
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
 * 装配顺序：
 *   a. MessageRouter 单例（所有 webview 共享）
 *   b. workspace roots → RepoRegistry.init（内部创建 service + watcher）
 *   c. GitContentProvider / DiffEditorManager（绑定到 registry.getCurrent()，
 *      切换 repo 时的适配留后续优化 —— 见 TODO 注释）
 *   d. ReactViewProvider × 2（gitLog / commitPanel）
 *   e. Manager / Panel 实例（merge / conflicts / push / rollback）
 *   f. 构造 GitHandlerContext（registry + getter 形式的 gitService）
 *   g. 注册 handler + command + 临时调试命令
 *   h. 状态栏项
 *   i. 全部 disposable push 到 context.subscriptions
 */
export async function setupGit(context: vscode.ExtensionContext): Promise<void> {
  // a. MessageRouter 单例（所有 webview 共享）
  const messageRouter = new MessageRouter();

  // b. 处理 workspace folders → RepoRegistry
  const allWorkspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(
    (f) => f.uri.fsPath,
  );
  const workspaceRoot = allWorkspaceRoots[0];

  // 临时存储 shelf diff 内容（base/modified 虚拟 URI → 文本）
  const shelfDiffContent = new Map<string, string>();

  // RepoRegistry 内部为每个 repo 创建 GitService + GitWatcher，
  // setupGit 不再手动遍历创建 service / watcher。
  const registry = new RepoRegistry(messageRouter, context);
  await registry.init(allWorkspaceRoots);
  context.subscriptions.push(registry);

  // c. GitContentProvider / DiffEditorManager
  //
  // TODO: 切换 repo 时 GitContentProvider 适配，后续优化。
  // 当前绑定到启动时的 registry.getCurrent()。diff 视图的虚拟文档读取
  // 仍走初始 repo；切换 repo 后需要重建或改为延迟从 registry 取。
  const gitService = registry.getCurrent();

  let diffManager: DiffEditorManager | null = null;

  if (gitService) {
    // 注册虚拟文档/文件系统 provider（git-atlas:/<path>?ref=<hash>）
    // 同时注册 TextDocumentContentProvider（文本 diff）和 FileSystemProvider
    // （二进制文件如图片），与参考项目一致。
    const contentProvider = new GitContentProvider(gitService);
    contentProvider.setExternalContentMap(shelfDiffContent);
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

    // TODO: 切换 repo 时 DiffEditor 适配，后续优化。
    diffManager = new DiffEditorManager(gitService);
  }

  // d. 注册 WebviewViewProvider
  //    gitLog → panel 模式；commitPanel → commit 模式
  const logProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "panel",
  );
  const commitProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "commit",
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
    shelfDiffContent,
  };

  // g. 注册 handler（MessageRouter）和 command（VSCode commands）
  registerGitHandlers(ctx);

  // 配置变更监听：gitAtlas.* 配置变化时通知 webview 热刷新
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitAtlas")) {
        messageRouter.broadcastEvent("gitConfigChanged", {});
      }
    }),
  );

  registerGitCommands(context, ctx);

  // h. 临时调试命令（不进 package.json contributes，仅内部 registerCommand
  //    用于阶段 A 手测后端联动）
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "git-atlas._debugSwitchRepo",
      async () => {
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
