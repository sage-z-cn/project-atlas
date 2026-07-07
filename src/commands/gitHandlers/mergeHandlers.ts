import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";

/**
 * Merge / rebase / cherry-pick handlers.
 *
 * Extracted from reference project extension.ts. State-mutating handlers
 * (mergeAction / rebaseAction / cherryPickAction) broadcast both
 * gitStateChanged and commitStateChanged after the operation; branch-level
 * entry points (mergeBranch / rebaseBranch / checkoutAndRebase / cherryPick)
 * only broadcast gitStateChanged, matching the reference semantics exactly.
 */
export function registerMergeHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "mergeBranch",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      return withProgress(ctx, async () => {
        await gitService.merge(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "rebaseBranch",
    requireGit(ctx, async (gitService, params) => {
      const onto = params.onto as string;
      return withProgress(ctx, async () => {
        await gitService.rebase(onto);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "checkoutAndRebase",
    requireGit(ctx, async (gitService, params) => {
      const branchToCheckout = params.branchToCheckout as string;
      const rebaseOnto = params.rebaseOnto as string;
      return withProgress(ctx, async () => {
        await gitService.checkoutAndRebase(branchToCheckout, rebaseOnto);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "mergeAction",
    requireGit(ctx, async (gitService, params) => {
      const action = params.action as "continue" | "abort";
      return withProgress(ctx, async () => {
        if (action === "continue") {
          await gitService.mergeContinue();
        } else {
          await gitService.mergeAbort();
        }
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        messageRouter.broadcastEvent("commitStateChanged", {});
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "rebaseAction",
    requireGit(ctx, async (gitService, params) => {
      const action = params.action as "continue" | "abort" | "skip";
      return withProgress(ctx, async () => {
        await gitService.rebaseAction(action);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        messageRouter.broadcastEvent("commitStateChanged", {});
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "cherryPick",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;
      return withProgress(ctx, async () => {
        await gitService.cherryPick(hash);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "cherryPickAction",
    requireGit(ctx, async (gitService, params) => {
      const action = params.action as "continue" | "abort" | "skip";
      return withProgress(ctx, async () => {
        await gitService.cherryPickAction(action);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        messageRouter.broadcastEvent("commitStateChanged", {});
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "cherryPickFileChanges",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;
      const filePath = params.filePath as string;
      await gitService.checkoutFileFromCommit(hash, filePath);
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );
}
