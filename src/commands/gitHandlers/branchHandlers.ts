import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";

/**
 * Branch operation handlers (checkout / create / delete / rename / compare).
 *
 * Extracted from reference project extension.ts. Mutation handlers broadcast
 * gitStateChanged after the operation completes. Long-running operations keep
 * their withProgress wrapper so the webview can show a progress indicator.
 */
export function registerBranchHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "checkoutBranch",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      return withProgress(ctx, async () => {
        await gitService.checkout(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "createBranch",
    requireGit(ctx, async (gitService, params) => {
      const newBranchName = params.newBranchName as string;
      const startPoint = params.startPoint as string;
      const checkout = params.checkout as boolean | undefined;
      const force = params.force as boolean | undefined;
      await gitService.createBranch(newBranchName, startPoint, force ?? false);
      if (checkout) {
        await gitService.checkout(newBranchName);
      }
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "deleteBranch",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      const isRemote = params.isRemote as boolean;
      const force = params.force as boolean | undefined;
      if (isRemote) {
        await gitService.deleteRemoteBranch(branchName);
      } else {
        await gitService.deleteBranch(branchName, force ?? false);
      }
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "renameBranch",
    requireGit(ctx, async (gitService, params) => {
      const oldName = params.oldName as string;
      const newName = params.newName as string;
      await gitService.renameBranch(oldName, newName);
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "createBranchFromCommit",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      const hash = params.hash as string;
      const checkout = params.checkout as boolean | undefined;
      const force = params.force as boolean | undefined;
      await gitService.createBranchFromCommit(branchName, hash, force ?? false);
      if (checkout) {
        await gitService.checkout(branchName);
      }
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "createBranchPrompt",
    requireGit(ctx, async (gitService, params) => {
      const name = params.branchName as string | undefined;
      const checkout = params.checkout as boolean | undefined;
      const force = params.force as boolean | undefined;
      if (!name) return { success: false };
      return withProgress(ctx, async () => {
        await gitService.createBranch(name, "HEAD", force ?? false);
        if (checkout) {
          await gitService.checkout(name);
        }
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  // Modal confirmation: prompts the user before deleting the branch.
  messageRouter.handle(
    "deleteBranchPrompt",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      if (!branchName) return { success: false };
      const confirm = await vscode.window.showWarningMessage(
        `Delete branch "${branchName}"?`,
        { modal: true },
        "Delete",
      );
      if (confirm !== "Delete") return { success: false };
      return withProgress(ctx, async () => {
        await gitService.deleteBranch(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

}
