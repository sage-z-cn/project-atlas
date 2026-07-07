import * as vscode from "vscode";
import { NOT_GIT_REPO, requireGit } from "../gitContext";
import type { GitHandlerContext } from "../gitContext";
import { GIT_ATLAS_SCHEME } from "../../webview/gitContentProvider";
import type { RollbackFileInfo } from "../../webview/rollbackPanel";

/**
 * Rollback / file-delete handlers plus rollback-panel orchestration and
 * working-file diff commands.
 *
 * Extracted from reference project extension.ts. Modal-confirmation handlers
 * (rollbackFile / rollbackFiles / deleteFiles) keep their showWarningMessage
 * prompt inside requireGit so the NOT_GIT_REPO guard still fires first.
 * executeRollback inspects each file's working-tree status to decide between
 * git checkout (tracked-modified) and filesystem delete (added/untracked).
 */
export function registerRollbackHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  // Modal confirmation: prompts before reverting a single file.
  messageRouter.handle(
    "rollbackFile",
    requireGit(ctx, async (gitService, params) => {
      const filePath = params.filePath as string;
      const choice = await vscode.window.showWarningMessage(
        `Rollback changes to "${filePath}"? This cannot be undone.`,
        { modal: true },
        "Rollback",
      );
      if (choice !== "Rollback") return { success: false };
      await gitService.rollbackFile(filePath);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  // Modal confirmation: prompts before reverting multiple files.
  messageRouter.handle(
    "rollbackFiles",
    requireGit(ctx, async (gitService, params) => {
      const filePaths = params.filePaths as string[];
      if (!filePaths || filePaths.length === 0) return { success: false };
      const choice = await vscode.window.showWarningMessage(
        `Rollback changes to ${filePaths.length} file(s)? This cannot be undone.`,
        { modal: true },
        "Rollback",
      );
      if (choice !== "Rollback") return { success: false };
      for (const filePath of filePaths) {
        await gitService.rollbackFile(filePath);
      }
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  // deleteFiles guards on workspaceRoot (not gitService) — written by hand.
  messageRouter.handle("deleteFiles", async (params) => {
    if (!ctx.workspaceRoot) return NOT_GIT_REPO;
    const filePaths = params.filePaths as string[];
    if (!filePaths || filePaths.length === 0) return { success: false };

    const fileCount = filePaths.length;
    const message =
      fileCount === 1
        ? `Delete "${filePaths[0]}"? This cannot be undone.`
        : `Delete ${fileCount} files? This cannot be undone.`;

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return { success: false };

    for (const filePath of filePaths) {
      const fullPath = vscode.Uri.joinPath(
        vscode.Uri.file(ctx.workspaceRoot),
        filePath,
      );
      try {
        await vscode.workspace.fs.delete(fullPath, { recursive: true });
      } catch {
        // File may already be deleted, ignore
      }
    }
    messageRouter.broadcastEvent("commitStateChanged", {});
    return { success: true };
  });

  messageRouter.handle("openRollbackPanel", async (params) => {
    const files = params.files as RollbackFileInfo[];
    ctx.rollbackPanel.open(files);
    return { success: true };
  });

  messageRouter.handle(
    "executeRollback",
    requireGit(ctx, async (gitService, params) => {
      const filePaths = params.filePaths as string[];
      const deleteLocalCopies = params.deleteLocalCopies as boolean;

      try {
        // Get current working tree status to determine each file's state
        const workingTreeChanges = await gitService.getWorkingTreeChanges();
        const statusMap = new Map<string, string>();
        for (const file of workingTreeChanges) {
          statusMap.set(file.path, file.status);
        }

        for (const filePath of filePaths) {
          const status = statusMap.get(filePath) ?? "modified";
          if (status === "added" || status === "untracked") {
            if (deleteLocalCopies) {
              // Delete untracked/added file from filesystem
              const absPath = vscode.Uri.joinPath(
                vscode.Uri.file(ctx.workspaceRoot!),
                filePath,
              );
              await vscode.workspace.fs.delete(absPath);
            }
            // If deleteLocalCopies is false, skip untracked/added files
          } else {
            // Revert tracked file changes via git checkout
            await gitService.rollbackFile(filePath);
          }
        }

        messageRouter.broadcastEvent("commitStateChanged", {});
        ctx.rollbackPanel.close();
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    }),
  );

  messageRouter.handle("closeRollbackPanel", async () => {
    ctx.rollbackPanel.close();
    return { success: true };
  });

  messageRouter.handle(
    "showDiffForWorkingFile",
    requireGit(ctx, async (gitService, params) => {
      if (!ctx.workspaceRoot) return NOT_GIT_REPO;
      void gitService; // gitService presence is the guard; no further use
      const filePath = params.filePath as string;
      const staged = params.staged as boolean | undefined;

      const rightUri = vscode.Uri.joinPath(
        vscode.Uri.file(ctx.workspaceRoot),
        filePath,
      );

      // Both branches diff HEAD against the requested side (staged or working
      // tree); the title is the only difference.
      const leftUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=HEAD`,
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        staged
          ? `${filePath} (HEAD ↔ Staged)`
          : `${filePath} (HEAD ↔ Working Tree)`,
      );
      return { success: true };
    }),
  );

  messageRouter.handle(
    "openFileAtRevision",
    requireGit(ctx, async (_gitService, params) => {
      const filePath = params.filePath as string;
      const ref = params.ref as string;
      const uri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=${ref}`,
      );
      await vscode.window.showTextDocument(uri, { preview: true });
      return { success: true };
    }),
  );

  // refreshGitState tolerates a null gitService — written by hand.
  messageRouter.handle("refreshGitState", async () => {
    if (ctx.gitService) {
      ctx.gitService.invalidateCache();
    }
    messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
    return { success: true };
  });
}
