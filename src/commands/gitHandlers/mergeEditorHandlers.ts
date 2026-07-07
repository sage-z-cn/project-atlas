import * as vscode from "vscode";
import { requireGit } from "../gitContext";
import type { GitHandlerContext } from "../gitContext";
import type { DiffFile } from "../../git/types";

/**
 * Merge-editor / diff-editor orchestration handlers.
 *
 * Extracted from reference project extension.ts. openDiffEditor negotiates a
 * rich parameter shape (filePath / file object / fileList / baseRef /
 * cherryPickHashes) for next/prev navigation; the rest are thin adapters over
 * MergeEditorManager / GitService. confirmCancelMerge is a modal-only handler
 * and therefore bypasses requireGit.
 */
export function registerMergeEditorHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle("openMergeEditor", async (params) => {
    const file = (params.file as string) ?? "untitled";
    ctx.mergeManager.openMergeEditor(file);
    return undefined;
  });

  messageRouter.handle("openDiffEditor", async (params) => {
    if (!ctx.diffManager) return undefined;
    const commit = params.commit as string;
    const filePathParam = params.filePath as string | undefined;
    const fileParam = params.file as string | DiffFile | undefined;
    const baseRef = params.baseRef as string | undefined;
    const cherryPickHashes = params.cherryPickHashes as string[] | undefined;
    const fileList = params.fileList as DiffFile[] | undefined;
    const fileMeta =
      typeof fileParam === "object" && fileParam !== null
        ? (fileParam as DiffFile)
        : undefined;
    const filePath =
      filePathParam ??
      (typeof fileParam === "string" ? fileParam : undefined) ??
      fileMeta?.newPath ??
      fileMeta?.oldPath;

    if (commit && filePath) {
      // Set file list for next/prev navigation
      if (fileList && fileList.length > 0) {
        ctx.diffManager.setDiffFileList(
          fileList,
          commit,
          baseRef,
          cherryPickHashes,
        );
        // Set current index to the file being opened
        const idx = fileList.findIndex(
          (f) => (f.newPath || f.oldPath) === filePath,
        );
        if (idx >= 0) {
          ctx.diffManager.setCurrentIndex(idx);
        }
      }

      await ctx.diffManager.openDiffEditor(
        commit,
        filePath,
        fileMeta,
        baseRef,
        cherryPickHashes,
      );
    }
    return undefined;
  });

  messageRouter.handle("closeMergeEditor", async (params) => {
    const filePath = params.filePath as string;
    ctx.mergeManager.closeMergeEditor(filePath);
    return { success: true };
  });

  messageRouter.handle(
    "saveMergedContent",
    requireGit(ctx, async (gitService, params) => {
      await gitService.saveMergedContent(
        params.filePath as string,
        params.content as string,
      );
      return { success: true };
    }),
  );

  messageRouter.handle(
    "acceptOurs",
    requireGit(ctx, async (gitService, params) => {
      await gitService.acceptOurs(params.filePath as string);
      return { success: true };
    }),
  );

  messageRouter.handle(
    "acceptTheirs",
    requireGit(ctx, async (gitService, params) => {
      await gitService.acceptTheirs(params.filePath as string);
      return { success: true };
    }),
  );

  // Modal confirmation; bypasses requireGit because it never touches git.
  messageRouter.handle("confirmCancelMerge", async (params) => {
    const hasChanges = params.hasChanges as boolean;
    if (!hasChanges) return { confirmed: true };
    const choice = await vscode.window.showWarningMessage(
      "You have unsaved merge changes. Discard them?",
      { modal: true },
      "Discard",
    );
    return { confirmed: choice === "Discard" };
  });

  messageRouter.handle("openConflictsPanel", async () => {
    await vscode.commands.executeCommand("git-atlas.openConflicts");
    return { success: true };
  });
}
