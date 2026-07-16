import * as vscode from "vscode";
import { NOT_GIT_REPO, requireGit } from "../gitContext";
import type { GitHandlerContext } from "../gitContext";
import { GIT_ATLAS_SCHEME } from "../../webview/gitContentProvider";

/**
 * Shelf / stash handlers (git-stash based).
 *
 * Extracted from reference project extension.ts. Modal-confirmation handler
 * (deleteShelve) keeps its prompt inside requireGit.
 */
export function registerShelfHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "shelveChanges",
    requireGit(ctx, async (gitService, params) => {
      const message = params.message as string | undefined;
      const filePaths = params.filePaths as string[] | undefined;
      await gitService.shelveChanges(message ?? "", filePaths);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "unshelveChanges",
    requireGit(ctx, async (gitService, params) => {
      const stashId = params.stashId as string;
      const drop = (params.drop as boolean) ?? true;
      await gitService.unshelveChanges(stashId, drop);
      messageRouter.broadcastEvent("commitStateChanged", {});
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  // Modal confirmation before deleting a stash entry.
  messageRouter.handle(
    "deleteShelve",
    requireGit(ctx, async (gitService, params) => {
      const stashId = params.stashId as string;
      const choice = await vscode.window.showWarningMessage(
        `Delete stashed changes "${stashId}"? This cannot be undone.`,
        { modal: true },
        "Delete",
      );
      if (choice !== "Delete") return { success: false };
      await gitService.deleteShelve(stashId);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "showShelfFileDiff",
    requireGit(ctx, async (gitService, params) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;
      const stashId = params.stashId as string;
      const filePath = params.filePath as string;

      const repoQuery = `&repo=${encodeURIComponent(gitService.cwd)}`;
      const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
      // Show diff between the stash version and the parent (before stash)
      const stashUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=${stashId}${repoQuery}`,
      );
      const parentUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=${stashId}^${repoQuery}`,
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        parentUri,
        stashUri,
        `${fileName} (Shelved: ${stashId})`,
      );
      return { success: true };
    }),
  );

  messageRouter.handle(
    "unshelveFile",
    requireGit(ctx, async (gitService, params) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;
      const stashId = params.stashId as string;
      const filePath = params.filePath as string;

      // Checkout the single file from the stash into the working tree
      try {
        await gitService.checkoutFileFromCommit(stashId, filePath);
        messageRouter.broadcastEvent("commitStateChanged", {});
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `Failed to unshelve file: ${message}`,
        );
        return { success: false };
      }
    }),
  );
}
