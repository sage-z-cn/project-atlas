import * as nodefs from "node:fs/promises";
import * as vscode from "vscode";
import { NOT_GIT_REPO, requireGit } from "../gitContext";
import type { GitHandlerContext } from "../gitContext";
import { GIT_ATLAS_SCHEME } from "../../webview/gitContentProvider";
import { parseIdeaPatchForFile } from "../../utils/ideaPatch";

/**
 * Shelf / stash / patch handlers (both git-stash and IDEA .idea/shelf formats).
 *
 * Extracted from reference project extension.ts. Modal-confirmation handlers
 * (deleteShelve / deleteIdeaShelf) keep their prompt inside requireGit. IDEA
 * patch handlers read the on-disk shelved.patch file via nodefs and delegate
 * diff reconstruction to parseIdeaPatchForFile.
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
    requireGit(ctx, async (_gitService, params) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;
      const stashId = params.stashId as string;
      const filePath = params.filePath as string;

      // Show diff between the stash version and the parent (before stash)
      const stashUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=${stashId}`,
      );
      const parentUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=${stashId}^`,
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        parentUri,
        stashUri,
        `${filePath} (Shelved: ${stashId})`,
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

  // ─── IDEA Shelf Handlers ────────────────────────────────────────────

  messageRouter.handle(
    "ideaShelveChanges",
    requireGit(ctx, async (gitService, params) => {
      const message = params.message as string | undefined;
      const filePaths = params.filePaths as string[] | undefined;
      await gitService.ideaShelveChanges(message ?? "", filePaths);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "ideaUnshelveChanges",
    requireGit(ctx, async (gitService, params) => {
      const shelfName = params.shelfName as string;
      const drop = (params.drop as boolean) ?? true;
      await gitService.ideaUnshelveChanges(shelfName, drop);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  // Modal confirmation before deleting an IDEA shelf.
  messageRouter.handle(
    "deleteIdeaShelf",
    requireGit(ctx, async (gitService, params) => {
      const shelfName = params.shelfName as string;
      const choice = await vscode.window.showWarningMessage(
        `Delete shelf "${shelfName}"? This cannot be undone.`,
        { modal: true },
        "Delete",
      );
      if (choice !== "Delete") return { success: false };
      await gitService.deleteIdeaShelf(shelfName);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "showIdeaShelfFileDiff",
    requireGit(ctx, async (_gitService, params) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;
      const shelfName = params.shelfName as string;
      const filePath = params.filePath as string;

      // Multi-repo: the .idea/shelf dir lives under the owning repo root.
      const repoRoot =
        (params?.repoPath as string) ||
        ctx.registry.getCurrentRepoPath() ||
        ctx.workspaceRoot;
      const patchFile = `${repoRoot}/.idea/shelf/${shelfName}/shelved.patch`;
      try {
        const patchContent = await nodefs.readFile(patchFile, "utf-8");

        // Parse IDEA patch format to extract base content and modified content
        const { baseContent, modifiedContent } = parseIdeaPatchForFile(
          patchContent,
          filePath,
        );

        // Create virtual documents for both sides and show diff
        const baseUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/shelved/${shelfName}/${filePath}?ref=base`,
        );
        const modifiedUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/shelved/${shelfName}/${filePath}?ref=modified`,
        );

        // Register temporary content for these URIs
        ctx.shelfDiffContent.set(baseUri.toString(), baseContent);
        ctx.shelfDiffContent.set(modifiedUri.toString(), modifiedContent);

        await vscode.commands.executeCommand(
          "vscode.diff",
          baseUri,
          modifiedUri,
          `${filePath.split("/").pop()} (Shelved in ${shelfName})`,
        );
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `Could not show diff for "${filePath}": ${msg}`,
        );
        return { success: false };
      }
    }),
  );

  messageRouter.handle(
    "createPatchFromShelf",
    requireGit(ctx, async (_gitService, params) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;
      const shelfName = params.shelfName as string;
      // Multi-repo: resolve the owning repo root for .idea/shelf + save dialog.
      const repoRoot =
        (params?.repoPath as string) ||
        ctx.registry.getCurrentRepoPath() ||
        ctx.workspaceRoot;
      const patchFile = `${repoRoot}/.idea/shelf/${shelfName}/shelved.patch`;

      // Ask user where to save the patch
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${repoRoot}/${shelfName}.patch`),
        filters: { "Patch files": ["patch", "diff"], "All files": ["*"] },
        title: "Save Patch File",
      });

      if (!saveUri) return { success: false };

      try {
        const patchContent = await nodefs.readFile(patchFile, "utf-8");
        await nodefs.writeFile(saveUri.fsPath, patchContent, "utf-8");
        void vscode.window.showInformationMessage(
          `Patch saved to ${saveUri.fsPath}`,
        );
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Failed to create patch: ${msg}`);
        return { success: false };
      }
    }),
  );

  messageRouter.handle(
    "copyShelfPatchToClipboard",
    requireGit(ctx, async (_gitService, params) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;
      const shelfName = params.shelfName as string;
      // Multi-repo: the .idea/shelf dir lives under the owning repo root.
      const repoRoot =
        (params?.repoPath as string) ||
        ctx.registry.getCurrentRepoPath() ||
        ctx.workspaceRoot;
      const patchFile = `${repoRoot}/.idea/shelf/${shelfName}/shelved.patch`;

      try {
        const patchContent = await nodefs.readFile(patchFile, "utf-8");
        await vscode.env.clipboard.writeText(patchContent);
        void vscode.window.showInformationMessage("Patch copied to clipboard");
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Failed to copy patch: ${msg}`);
        return { success: false };
      }
    }),
  );

  messageRouter.handle(
    "importPatches",
    requireGit(ctx, async (gitService) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;

      // Ask user to select patch files
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { "Patch files": ["patch", "diff"], "All files": ["*"] },
        title: "Import Patch Files",
      });

      if (!fileUris || fileUris.length === 0) return { success: false };

      try {
        for (const uri of fileUris) {
          const patchContent = await nodefs.readFile(uri.fsPath, "utf-8");

          // Create a shelf entry from the imported patch
          const fileName = uri.fsPath.split("/").pop() ?? "Imported";
          const shelfName = fileName.replace(/\.(patch|diff)$/, "");
          await gitService.importPatchAsShelf(shelfName, patchContent);
        }

        messageRouter.broadcastEvent("commitStateChanged", {});
        void vscode.window.showInformationMessage(
          `Imported ${fileUris.length} patch${fileUris.length > 1 ? "es" : ""}`,
        );
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Failed to import patches: ${msg}`);
        return { success: false };
      }
    }),
  );

  messageRouter.handle(
    "importPatchFromClipboard",
    requireGit(ctx, async (gitService) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;

      try {
        const clipboardContent = await vscode.env.clipboard.readText();
        if (!clipboardContent || !clipboardContent.trim()) {
          void vscode.window.showWarningMessage(
            "Clipboard is empty or does not contain patch content.",
          );
          return { success: false };
        }

        // Validate it looks like a patch
        if (
          !clipboardContent.includes("diff ") &&
          !clipboardContent.includes("---") &&
          !clipboardContent.includes("@@")
        ) {
          void vscode.window.showWarningMessage(
            "Clipboard content does not appear to be a valid patch.",
          );
          return { success: false };
        }

        const shelfName = `Clipboard patch ${new Date().toLocaleString()}`;
        await gitService.importPatchAsShelf(shelfName, clipboardContent);

        messageRouter.broadcastEvent("commitStateChanged", {});
        void vscode.window.showInformationMessage(
          "Imported patch from clipboard as shelf entry.",
        );
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `Failed to import patch from clipboard: ${msg}`,
        );
        return { success: false };
      }
    }),
  );
}
