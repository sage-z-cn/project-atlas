import type { MessageRouter, CommandHandler } from "../messages/messageRouter";
import type { GitService } from "../git/gitService";
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
 * function captured (messageRouter, gitService, allGitServices, diffManager,
 * mergeManager, conflictsManager, pushPanel, rollbackPanel, workspaceRoot,
 * shelfDiffContent). Keeping these behind a single object lets handlers be
 * extracted into independent modules without recreating the closure graph.
 */
export interface GitHandlerContext {
  messageRouter: MessageRouter;
  gitService: GitService | null;
  allGitServices: GitService[];
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
 * Higher-order helper that guards a handler against a null `gitService`.
 *
 * Most read/write handlers share the same prologue:
 *
 *   if (!gitService) return NOT_GIT_REPO;
 *
 * Wrapping with requireGit collapses that boilerplate while preserving the
 * exact sentinel shape returned to the webview. Handlers that need a
 * different fallback (e.g. getCherryPickState returns { isCherryPicking: false })
 * or that depend on allGitServices instead of gitService should be written
 * by hand.
 */
export function requireGit<T>(
  ctx: GitHandlerContext,
  handler: (
    gitService: GitService,
    params: Record<string, unknown>,
  ) => Promise<T>,
): CommandHandler {
  return async (params) => {
    if (!ctx.gitService) return NOT_GIT_REPO;
    return handler(ctx.gitService, params);
  };
}
