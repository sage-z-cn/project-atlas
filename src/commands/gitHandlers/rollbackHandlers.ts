import * as fs from "fs";
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
      const rollbackBtn = vscode.l10n.t("Rollback");
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Rollback changes to "{0}"? This cannot be undone.',
          filePath,
        ),
        { modal: true },
        rollbackBtn,
      );
      if (choice !== rollbackBtn) return { success: false };
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
      const rollbackBtn = vscode.l10n.t("Rollback");
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Rollback changes to {0} file(s)? This cannot be undone.",
          filePaths.length,
        ),
        { modal: true },
        rollbackBtn,
      );
      if (choice !== rollbackBtn) return { success: false };
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

    // Multi-repo: resolve the owning repo root for the absolute paths.
    const repoRoot =
      (params?.repoPath as string) ||
      ctx.registry.getCurrentRepoPath() ||
      ctx.workspaceRoot;

    const fileCount = filePaths.length;
    const deleteBtn = vscode.l10n.t("Delete");
    const message =
      fileCount === 1
        ? vscode.l10n.t('Delete "{0}"? This cannot be undone.', filePaths[0])
        : vscode.l10n.t(
            "Delete {0} files? This cannot be undone.",
            fileCount,
          );

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      deleteBtn,
    );
    if (choice !== deleteBtn) return { success: false };

    for (const filePath of filePaths) {
      const fullPath = vscode.Uri.joinPath(
        vscode.Uri.file(repoRoot),
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

      // Multi-repo: resolve the owning repo root for filesystem deletes.
      const repoRoot =
        (params?.repoPath as string) ||
        ctx.registry.getCurrentRepoPath() ||
        ctx.workspaceRoot;

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
                vscode.Uri.file(repoRoot!),
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

      // Multi-repo: resolve the owning repo root for the working-tree file URI.
      const repoRoot =
        (params?.repoPath as string) ||
        ctx.registry.getCurrentRepoPath() ||
        ctx.workspaceRoot;

      // Correct diff semantics (mirrors VSCode's native SCM):
      //   staged=true  → diff HEAD ↔ index    (only the staged changes)
      //   staged=false → diff index ↔ worktree (only the unstaged changes)
      // git ref ":0" resolves to the staged (index) blob for a path, so a file
      // that was staged then edited again shows just the unstaged edits when
      // opened from Changes (index ↔ worktree), not the full HEAD ↔ worktree.
      const worktreeUri = vscode.Uri.joinPath(
        vscode.Uri.file(repoRoot),
        filePath,
      );
      const indexUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=:0`,
      );
      const headUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${filePath}?ref=HEAD`,
      );

      if (staged) {
        // HEAD ↔ Staged (index)
        await vscode.commands.executeCommand(
          "vscode.diff",
          headUri,
          indexUri,
          `${filePath} (HEAD ↔ Staged)`,
        );
      } else {
        // Staged (index) ↔ Working Tree
        // A deleted file no longer exists on disk, so a real file: URI would
        // make VSCode fail with a "File not found" read error. Fall back to a
        // virtual empty document (?ref=empty) as the right side, mirroring how
        // the commit-history diff path renders deletions.
        const rightUri = fs.existsSync(worktreeUri.fsPath)
          ? worktreeUri
          : vscode.Uri.parse(`${GIT_ATLAS_SCHEME}:/${filePath}?ref=empty`);
        await vscode.commands.executeCommand(
          "vscode.diff",
          indexUri,
          rightUri,
          `${filePath} (Staged ↔ Working Tree)`,
        );
      }
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
