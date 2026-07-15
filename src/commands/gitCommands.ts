import * as path from "node:path";
import * as vscode from "vscode";
import type { GitHandlerContext } from "./gitContext";
import { GIT_ATLAS_SCHEME } from "../webview/gitContentProvider";
import { getScmResourcePath } from "../utils/ideaPatch";

/**
 * Register the 12 `git-atlas.*` commands declared in package.json.
 *
 * Extracted from reference project extension.ts (the `vscode.commands.
 * registerCommand` block inside activate). Command ids use the `git-atlas.*`
 * prefix declared in this project's package.json, and user-visible strings
 * are rebranded with the "Git Atlas:" prefix.
 *
 * The 5 `commitPanel.*` commands declared in the reference project's
 * package.json but never registered in extension.ts (dead code) are
 * intentionally NOT migrated here.
 *
 * Each registered Disposable is pushed onto context.subscriptions so VS Code
 * cleans them up on extension deactivation.
 */
export function registerGitCommands(
  context: vscode.ExtensionContext,
  ctx: GitHandlerContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("git-atlas.openPushPanel", async () => {
      if (!ctx.gitService) return;
      const branch = await ctx.gitService.getCurrentBranch();
      if (branch) {
        const remote = await ctx.gitService.getDefaultRemote(branch);
        ctx.pushPanel.open(branch, remote);
      }
    }),
    vscode.commands.registerCommand(
      "git-atlas.openMergeEditor",
      (file?: string) => {
        ctx.mergeManager.openMergeEditor(file ?? "untitled");
      },
    ),
    vscode.commands.registerCommand(
      "git-atlas.openDiffEditor",
      (commit?: string, filePath?: string) => {
        if (commit && filePath && ctx.diffManager) {
          ctx.diffManager.openDiffEditor(commit, filePath);
        }
      },
    ),
    vscode.commands.registerCommand("git-atlas.refreshLog", () => {
      ctx.messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
    }),
    vscode.commands.registerCommand("git-atlas.nextDiff", async () => {
      if (ctx.diffManager) {
        const result = await ctx.diffManager.nextDiff();
        if (!result) {
          void vscode.window.showInformationMessage(
            "Git Atlas: No diff file list. Double-click a file in Changed Files first.",
          );
        }
      } else {
        void vscode.window.showInformationMessage("Git Atlas: No workspace open.");
      }
    }),
    vscode.commands.registerCommand("git-atlas.prevDiff", async () => {
      if (ctx.diffManager) {
        const result = await ctx.diffManager.prevDiff();
        if (!result) {
          void vscode.window.showInformationMessage(
            "Git Atlas: No diff file list. Double-click a file in Changed Files first.",
          );
        }
      } else {
        void vscode.window.showInformationMessage("Git Atlas: No workspace open.");
      }
    }),
    vscode.commands.registerCommand("git-atlas.openConflicts", () => {
      ctx.conflictsManager.openConflictsPanel();
    }),
    vscode.commands.registerCommand(
      "git-atlas.openMergeEditorFromSCM",
      (arg?: unknown) => {
        const filePath = getScmResourcePath(arg);
        if (!filePath) {
          void vscode.window.showWarningMessage(
            "Unable to locate conflict file from SCM item.",
          );
          return;
        }
        ctx.mergeManager.openMergeEditor(filePath);
      },
    ),
    vscode.commands.registerCommand(
      "git-atlas.showFileHistory",
      async (uri?: vscode.Uri) => {
        const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!fileUri) return;
        // Resolve the OWNING repo from the file path (not the currently-active
        // one) and switch to it, so git log runs against the right repo.
        const repo = ctx.registry.findRepoForPath(fileUri.fsPath);
        if (!repo) return; // file lives outside every known repo
        if (repo.path !== ctx.registry.getCurrentRepoPath()) {
          await ctx.registry.setCurrent(repo.path); // broadcasts repoChanged
        }
        // git log -- <file> needs a path relative to the REPO root, not the
        // workspace root — they differ when the repo is a workspace subfolder.
        const relativePath = path.relative(repo.path, fileUri.fsPath);
        // Ensure the Git Log panel is visible before sending the event
        await vscode.commands.executeCommand("git-atlas.gitLog.focus");
        // Carry repoPath so the store can sync if the repoChanged fetch (from
        // setCurrent above) lands out of order with the file-filter fetch.
        ctx.messageRouter.broadcastEvent("showFileHistory", {
          file: relativePath,
          repoPath: repo.path,
        });
      },
    ),
    vscode.commands.registerCommand("git-atlas.openGitLog", async () => {
      // Reveal the bottom-panel Git Log view from the Commit panel toolbar.
      await vscode.commands.executeCommand("git-atlas.gitLog.focus");
    }),
    vscode.commands.registerCommand("git-atlas.openCommitPanel", async () => {
      // Reveal the activity-bar Commit panel from the Git Log toolbar.
      await vscode.commands.executeCommand("git-atlas.commitPanel.focus");
    }),
    vscode.commands.registerCommand("git-atlas.editSource", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uri = editor.document.uri;
      const line = editor.selection.active.line;
      const character = editor.selection.active.character;

      // Multi-repo: resolve the owning repo root — editSource is a plain
      // registerCommand (no bridge params), so use the currently-selected repo
      // and fall back to the legacy workspace root.
      const repoRoot = ctx.registry.getCurrentRepoPath() ?? ctx.workspaceRoot;

      // Resolve the actual workspace file path from diff URI
      // Format: git-atlas:/<relativePath>?ref=<commitHash>
      let filePath: string | undefined;

      if (uri.scheme === "file") {
        filePath = uri.fsPath;
      } else if (uri.scheme === GIT_ATLAS_SCHEME || uri.scheme === "git") {
        // Extract relative path from URI path (strip leading /)
        const relativePath = uri.path.startsWith("/")
          ? uri.path.slice(1)
          : uri.path;
        if (relativePath && repoRoot) {
          filePath = vscode.Uri.joinPath(
            vscode.Uri.file(repoRoot),
            relativePath,
          ).fsPath;
        }
      } else {
        // Other schemes (e.g. vscode builtin git) — try path
        const relativePath = uri.path.startsWith("/")
          ? uri.path.slice(1)
          : uri.path;
        if (relativePath && repoRoot) {
          filePath = vscode.Uri.joinPath(
            vscode.Uri.file(repoRoot),
            relativePath,
          ).fsPath;
        }
      }

      if (!filePath) return;

      // Check if file exists before opening
      const fileUri = vscode.Uri.file(filePath);
      try {
        await vscode.workspace.fs.stat(fileUri);
      } catch {
        void vscode.window.showWarningMessage(
          "Source file does not exist in the working directory.",
        );
        return;
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(line, character, line, character),
        preview: false,
      });
    }),
    vscode.commands.registerCommand(
      "git-atlas.locateCommit",
      async (hash?: string, repoPath?: string) => {
        if (!hash || typeof hash !== "string") return;
        // Switch to the owning repo (the hover resolves it from the file's
        // path) so the log loads the history that contains this commit.
        if (repoPath && repoPath !== ctx.registry.getCurrentRepoPath()) {
          await ctx.registry.setCurrent(repoPath); // broadcasts repoChanged
        }
        // Stash BEFORE revealing the panel: the first click opens the panel
        // webview, which isn't mounted yet and can't receive the focusCommit
        // broadcast. The webview drains this on initRepo. Subsequent clicks
        // (webview already live) are handled directly by the broadcast below.
        ctx.pendingFocus.hash = hash;
        // Reveal the Git Log panel.
        await vscode.commands.executeCommand("git-atlas.gitLog.focus");
        // Tell the panel to scroll to + select the commit. The store clears
        // any active filter first and pages in more history if the commit sits
        // beyond the loaded window.
        ctx.messageRouter.broadcastEvent("focusCommit", { hash });
      },
    ),
  );
}
