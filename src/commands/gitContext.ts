import type { MessageRouter, CommandHandler } from "../messages/messageRouter";
import type { GitService } from "../git/gitService";
import type { RepoRegistry } from "../git/repoRegistry";
import type { DiffEditorManager } from "../webview/diffEditorManager";
import type { MergeEditorManager } from "../webview/mergeEditorManager";
import type { ConflictsManager } from "../webview/conflictsManager";
import type { PushPanel } from "../webview/pushPanel";
import type { RollbackPanel } from "../webview/rollbackPanel";

/**
 * Sentinel returned by handlers when no GitService is available for the
 * active workspace. Mirrors the reference project's NOT_GIT_REPO constant
 * so the webview-side contract remains unchanged.
 */
export const NOT_GIT_REPO = { status: "not_git_repo" as const, data: null };

/**
 * Shared context object passed into every git handler registration function.
 *
 * Replaces the closed-over locals that the reference project's `activate()`
 * function captured (messageRouter, gitService, diffManager, mergeManager,
 * conflictsManager, pushPanel, rollbackPanel, workspaceRoot,
 * shelfDiffContent). Keeping these behind a single object lets handlers be
 * extracted into independent modules without recreating the closure graph.
 *
 * Multi-repo (phase A): the `registry` field owns every GitService / watcher
 * and tracks the currently-selected repo. `gitService` is kept as a getter
 * alias for `registry.getCurrent()` so pre-existing handlers that still read
 * `ctx.gitService` continue to work against whichever repo is active.
 */
export interface GitHandlerContext {
  messageRouter: MessageRouter;
  /** Multi-repo registry — single source of truth for services + current repo. */
  registry: RepoRegistry;
  /**
   * Convenience accessor for the currently-selected repo's GitService.
   * Equivalent to `registry.getCurrent()`. Implemented as a getter in
   * setupGit so it always reflects the live selection rather than a snapshot
   * taken at activation time. Existing handlers (getCherryPickState /
   * getRebaseState / refreshGitState / openPushPanel) read this directly and
   * therefore automatically follow repo switches.
   */
  readonly gitService: GitService | null;
  diffManager: DiffEditorManager | null;
  mergeManager: MergeEditorManager;
  conflictsManager: ConflictsManager;
  pushPanel: PushPanel;
  rollbackPanel: RollbackPanel;
  workspaceRoot: string | undefined;
  /** Temporary storage for shelf diff content (base/modified virtual URIs). */
  shelfDiffContent: Map<string, string>;
}

/**
 * Wrap a git operation with operationStart/operationEnd events so the webview
 * can surface a progress indicator. Faithful port of the reference project's
 * withProgress helper (extension.ts lines 27-35), rerouted through ctx.
 */
export function withProgress<T>(
  ctx: GitHandlerContext,
  fn: () => Promise<T>,
): Promise<T> {
  ctx.messageRouter.broadcastEvent("operationStart", {});
  return fn().finally(() => {
    ctx.messageRouter.broadcastEvent("operationEnd", {});
  });
}

/**
 * Higher-order helper that guards a handler against the "no active repo" case.
 *
 * Multi-repo aware: resolves the target GitService via the registry, either
 * from an explicit `params.repoPath` (normalized inside getService) or by
 * falling back to the currently-selected repo. Returns the NOT_GIT_REPO
 * sentinel when no service can be resolved.
 *
 * Handlers that need a different fallback (e.g. getCherryPickState returns
 * { isCherryPicking: false }) should still be written by hand.
 */
export function requireGit<T>(
  ctx: GitHandlerContext,
  handler: (
    gitService: GitService,
    params: Record<string, unknown>,
  ) => Promise<T>,
): CommandHandler {
  return async (params) => {
    const svc = params?.repoPath
      ? ctx.registry.getService(params.repoPath as string)
      : ctx.registry.getCurrent();
    if (!svc) return NOT_GIT_REPO;
    return handler(svc, params);
  };
}
