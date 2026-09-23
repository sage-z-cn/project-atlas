import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import type { GitService } from "../git/gitService";

export class GitWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  // 单一 debounce timer：一次 commit 会错峰触发多个 scope（HEAD、refs、
  // index、COMMIT_EDITMSG）的 notify，per-scope 独立防抖会把它们错峰广播
  // 成多轮 invalidate + gitStateChanged。改为任意 scope 的 notify 都重置
  // 同一个 300ms timer，到期只执行一轮失效 + 一次广播（scope 固定
  // "all"——消费方不细分 watcher 广播的 scope，panel-store 仅识别 host
  // 命令发来的 scope:"navigateToHead" 特殊值，不来自本 watcher）。
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // 分类失效累计（窗口内多个事件可叠加）：refs 类（HEAD / refs/** 变更）
  // 才 invalidate log/branches/tags 缓存；index 类（保存、stage、merge
  // 状态文件）只失效 working-tree 状态；config 类只失效 remote/identity
  // 派生缓存。到期时按累计结果选最宽的失效档位，让面板的事件刷新回合
  // 在 refs 未动时几乎零子进程（log/branches/tags 全部缓存命中）。
  private sawRefsChange = false;
  private sawConfigChange = false;

  private readonly _onChanged = new vscode.EventEmitter<void>();
  /**
   * Extension-side signal that this repo's git state changed.
   *
   * Fired alongside (not instead of) the webview `gitStateChanged` broadcast,
   * after the same 300ms debounce and cache invalidation. Lets extension-host
   * listeners (e.g. the status bar) refresh without going through the webview
   * MessageRouter. Disposed when the watcher is disposed.
   */
  readonly onChanged = this._onChanged.event;

  constructor(
    private readonly workspaceRoot: string,
    private readonly messageRouter: MessageRouter,
    // 传 GitService 而非其 cache：到期时按变更分类调用 svc 的分层失效
    // 方法（invalidateCache / invalidateConfigCache / invalidateStatusCache），
    // 保持单一失效入口。
    private readonly svc: GitService,
  ) {
    this.setupFileWatchers();
    this.setupEditorWatchers();
  }

  private setupFileWatchers(): void {
    const gitBase = vscode.Uri.file(`${this.workspaceRoot}/.git`);

    // ── refs 类：提交图/分支/tag 派生数据变化 ──────────────────────────

    // .git/HEAD → refs
    const headWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "HEAD"),
    );
    headWatcher.onDidChange(() => this.notify("refs"));
    headWatcher.onDidCreate(() => this.notify("refs"));
    headWatcher.onDidDelete(() => this.notify("refs"));
    this.disposables.push(headWatcher);

    // .git/refs/heads/** → refs
    const headsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "refs/heads/**"),
    );
    headsWatcher.onDidChange(() => this.notify("refs"));
    headsWatcher.onDidCreate(() => this.notify("refs"));
    headsWatcher.onDidDelete(() => this.notify("refs"));
    this.disposables.push(headsWatcher);

    // .git/refs/remotes/** → refs
    const remotesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "refs/remotes/**"),
    );
    remotesWatcher.onDidChange(() => this.notify("refs"));
    remotesWatcher.onDidCreate(() => this.notify("refs"));
    remotesWatcher.onDidDelete(() => this.notify("refs"));
    this.disposables.push(remotesWatcher);

    // .git/refs/tags/** → refs (tags group)
    const tagsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "refs/tags/**"),
    );
    tagsWatcher.onDidChange(() => this.notify("refs"));
    tagsWatcher.onDidCreate(() => this.notify("refs"));
    tagsWatcher.onDidDelete(() => this.notify("refs"));
    this.disposables.push(tagsWatcher);

    // ── index 类：只影响 working-tree 状态，不改提交图 ──────────────────

    // .git/index → status
    const indexWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "index"),
    );
    indexWatcher.onDidChange(() => this.notify("index"));
    this.disposables.push(indexWatcher);

    // .git/MERGE_HEAD → mergeState
    const mergeHeadWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "MERGE_HEAD"),
    );
    mergeHeadWatcher.onDidChange(() => this.notify("index"));
    mergeHeadWatcher.onDidCreate(() => this.notify("index"));
    mergeHeadWatcher.onDidDelete(() => this.notify("index"));
    this.disposables.push(mergeHeadWatcher);

    // .git/CHERRY_PICK_HEAD → mergeState (cherry-pick state)
    const cherryPickHeadWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "CHERRY_PICK_HEAD"),
    );
    cherryPickHeadWatcher.onDidChange(() => this.notify("index"));
    cherryPickHeadWatcher.onDidCreate(() => this.notify("index"));
    cherryPickHeadWatcher.onDidDelete(() => this.notify("index"));
    this.disposables.push(cherryPickHeadWatcher);

    // .git/rebase-merge/** → mergeState (rebase state)
    const rebaseMergeWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "rebase-merge/**"),
    );
    rebaseMergeWatcher.onDidChange(() => this.notify("index"));
    rebaseMergeWatcher.onDidCreate(() => this.notify("index"));
    rebaseMergeWatcher.onDidDelete(() => this.notify("index"));
    this.disposables.push(rebaseMergeWatcher);

    // .git/rebase-apply/** → mergeState (rebase state)
    const rebaseApplyWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "rebase-apply/**"),
    );
    rebaseApplyWatcher.onDidChange(() => this.notify("index"));
    rebaseApplyWatcher.onDidCreate(() => this.notify("index"));
    rebaseApplyWatcher.onDidDelete(() => this.notify("index"));
    this.disposables.push(rebaseApplyWatcher);

    // .git/COMMIT_EDITMSG → log
    const commitMsgWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "COMMIT_EDITMSG"),
    );
    commitMsgWatcher.onDidChange(() => this.notify("index"));
    commitMsgWatcher.onDidCreate(() => this.notify("index"));
    this.disposables.push(commitMsgWatcher);

    // ── config 类：remote 配置 / user identity 派生数据变化 ────────────

    // .git/config → config-derived caches (remotes, identity)。外部
    // `git remote add` / 手工编辑 config 都经由这里失效 configCache。
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "config"),
    );
    configWatcher.onDidChange(() => this.notify("config"));
    configWatcher.onDidCreate(() => this.notify("config"));
    configWatcher.onDidDelete(() => this.notify("config"));
    this.disposables.push(configWatcher);
  }

  private setupEditorWatchers(): void {
    // Save → status refresh.
    //
    // Multi-repo hard constraint: filter by workspaceRoot prefix. Without
    // this, N watchers (one per repo) would each fire on every save anywhere
    // in the workspace, amplifying notifications N-fold and causing every
    // repo's status cache to be invalidated on unrelated saves.
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.fsPath.startsWith(this.workspaceRoot)) {
          this.notify("index");
        }
      }),
    );
  }

  /**
   * External git-change ingress (e.g. builtinGitBridge → repoRegistry):
   * resets the same debounce timer as file-watcher notifications so external
   * and filesystem change sources converge into a single invalidation +
   * broadcast instead of each triggering its own round.
   *
   * "external" is deliberately conservative — we don't know WHAT changed, so
   * it escalates to the full invalidation (same tier as a refs change).
   */
  notifyExternal(): void {
    this.notify("external");
  }

  private notify(scope: "refs" | "index" | "config" | "external"): void {
    // Debounce 300ms, single timer across all scopes (see field comment).
    if (scope === "refs" || scope === "external") {
      this.sawRefsChange = true;
    } else if (scope === "config") {
      this.sawConfigChange = true;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      // Tiered invalidation: refs moved (or unknown external change) →
      // full clear including log/branches/tags; config-only → just the
      // config-derived caches; otherwise (index/save) → status only, so the
      // upcoming panel refresh round hits the log/branches/tags caches and
      // spawns almost nothing.
      if (this.sawRefsChange) {
        this.svc.invalidateCache();
      } else if (this.sawConfigChange) {
        this.svc.invalidateConfigCache();
      } else {
        this.svc.invalidateStatusCache();
      }
      this.sawRefsChange = false;
      this.sawConfigChange = false;
      // Multi-repo: tag the event with the owning repo so the webview can
      // decide whether to refetch (current repo) or ignore (other repo).
      this.messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoPath: this.workspaceRoot,
      });
      // Notify extension-host listeners (status bar, etc.).
      this._onChanged.fire();
    }, 300);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this._onChanged.dispose();
  }
}
