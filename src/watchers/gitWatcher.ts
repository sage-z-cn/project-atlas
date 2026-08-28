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
    // 传 GitService 而非其 cache：到期时调 svc.invalidateCache() 可同时
    // 失效 gitService 内部的 statusCache 等附加缓存，保持单一失效入口。
    private readonly svc: GitService,
  ) {
    this.setupFileWatchers();
    this.setupEditorWatchers();
  }

  private setupFileWatchers(): void {
    const gitBase = vscode.Uri.file(`${this.workspaceRoot}/.git`);

    // .git/HEAD → all
    const headWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "HEAD"),
    );
    headWatcher.onDidChange(() => this.notify());
    headWatcher.onDidCreate(() => this.notify());
    headWatcher.onDidDelete(() => this.notify());
    this.disposables.push(headWatcher);

    // .git/refs/heads/** → branches
    const headsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "refs/heads/**"),
    );
    headsWatcher.onDidChange(() => this.notify());
    headsWatcher.onDidCreate(() => this.notify());
    headsWatcher.onDidDelete(() => this.notify());
    this.disposables.push(headsWatcher);

    // .git/refs/remotes/** → branches
    const remotesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "refs/remotes/**"),
    );
    remotesWatcher.onDidChange(() => this.notify());
    remotesWatcher.onDidCreate(() => this.notify());
    remotesWatcher.onDidDelete(() => this.notify());
    this.disposables.push(remotesWatcher);

    // .git/refs/tags/** → branches (tags group)
    const tagsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "refs/tags/**"),
    );
    tagsWatcher.onDidChange(() => this.notify());
    tagsWatcher.onDidCreate(() => this.notify());
    tagsWatcher.onDidDelete(() => this.notify());
    this.disposables.push(tagsWatcher);

    // .git/index → status
    const indexWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "index"),
    );
    indexWatcher.onDidChange(() => this.notify());
    this.disposables.push(indexWatcher);

    // .git/MERGE_HEAD → mergeState
    const mergeHeadWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "MERGE_HEAD"),
    );
    mergeHeadWatcher.onDidChange(() => this.notify());
    mergeHeadWatcher.onDidCreate(() => this.notify());
    mergeHeadWatcher.onDidDelete(() => this.notify());
    this.disposables.push(mergeHeadWatcher);

    // .git/CHERRY_PICK_HEAD → mergeState (cherry-pick state)
    const cherryPickHeadWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "CHERRY_PICK_HEAD"),
    );
    cherryPickHeadWatcher.onDidChange(() => this.notify());
    cherryPickHeadWatcher.onDidCreate(() => this.notify());
    cherryPickHeadWatcher.onDidDelete(() => this.notify());
    this.disposables.push(cherryPickHeadWatcher);

    // .git/rebase-merge/** → mergeState (rebase state)
    const rebaseMergeWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "rebase-merge/**"),
    );
    rebaseMergeWatcher.onDidChange(() => this.notify());
    rebaseMergeWatcher.onDidCreate(() => this.notify());
    rebaseMergeWatcher.onDidDelete(() => this.notify());
    this.disposables.push(rebaseMergeWatcher);

    // .git/rebase-apply/** → mergeState (rebase state)
    const rebaseApplyWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "rebase-apply/**"),
    );
    rebaseApplyWatcher.onDidChange(() => this.notify());
    rebaseApplyWatcher.onDidCreate(() => this.notify());
    rebaseApplyWatcher.onDidDelete(() => this.notify());
    this.disposables.push(rebaseApplyWatcher);

    // .git/COMMIT_EDITMSG → log
    const commitMsgWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(gitBase, "COMMIT_EDITMSG"),
    );
    commitMsgWatcher.onDidChange(() => this.notify());
    commitMsgWatcher.onDidCreate(() => this.notify());
    this.disposables.push(commitMsgWatcher);
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
          this.notify();
        }
      }),
    );
  }

  /**
   * External git-change ingress (e.g. builtinGitBridge → repoRegistry):
   * resets the same debounce timer as file-watcher notifications so external
   * and filesystem change sources converge into a single invalidation +
   * broadcast instead of each triggering its own round.
   */
  notifyExternal(): void {
    this.notify();
  }

  private notify(): void {
    // Debounce 300ms, single timer across all scopes (see field comment).
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.svc.invalidateCache();
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
