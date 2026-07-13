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
import { registerRepoHandlers } from "./repoHandlers";
import { registerL10nBundleHandler } from "../../messages/l10nHandler";
import { registerConfigHandlers } from "./configHandlers";
import { registerAiHandlers } from "./aiHandlers";

/**
 * Aggregate entry point that registers every git-related MessageRouter
 * handler by delegating to per-domain registration functions.
 *
 * Call once during activation with a fully-populated GitHandlerContext:
 *
 *   registerGitHandlers(ctx);
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
  registerRepoHandlers(ctx);
  registerL10nBundleHandler(ctx.messageRouter, ctx.context);
  registerConfigHandlers(ctx);
  registerAiHandlers(ctx);
}
