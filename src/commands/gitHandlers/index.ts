import type { GitHandlerContext } from "../gitContext";
import { registerQueryHandlers } from "./queryHandlers";
import { registerBranchHandlers } from "./branchHandlers";
import { registerMergeHandlers } from "./mergeHandlers";
import { registerCommitHandlers } from "./commitHandlers";
import { registerRemoteHandlers } from "./remoteHandlers";
import { registerRollbackHandlers } from "./rollbackHandlers";
import { registerMergeEditorHandlers } from "./mergeEditorHandlers";
import { registerShelfHandlers } from "./shelfHandlers";
import { registerUiHandlers } from "./uiHandlers";

/**
 * Aggregate entry point that registers every git-related MessageRouter
 * handler (103 total) by delegating to per-domain registration functions.
 *
 * Call once during activation with a fully-populated GitHandlerContext:
 *
 *   registerGitHandlers(ctx);
 *
 * Handler counts (matches the reference project exactly):
 *   queryHandlers        22  (read-only queries + state inspection)
 *   branchHandlers        9  (checkout/create/delete/rename/compare)
 *   mergeHandlers         8  (merge/rebase/cherry-pick)
 *   commitHandlers       13  (stage/commit/reset/revert/tag/drop)
 *   remoteHandlers        9  (push/pull/fetch + push panel)
 *   rollbackHandlers      9  (rollback/delete-files + rollback panel)
 *   mergeEditorHandlers   8  (merge editor + diff orchestration)
 *   shelfHandlers        13  (stash + IDEA shelf + patch import/export)
 *   uiHandlers           12  (dialogs, clipboard, preference toggles)
 *   ────────────────────────
 *   total               103
 */
export function registerGitHandlers(ctx: GitHandlerContext): void {
  registerQueryHandlers(ctx);
  registerBranchHandlers(ctx);
  registerMergeHandlers(ctx);
  registerCommitHandlers(ctx);
  registerRemoteHandlers(ctx);
  registerRollbackHandlers(ctx);
  registerMergeEditorHandlers(ctx);
  registerShelfHandlers(ctx);
  registerUiHandlers(ctx);
}
