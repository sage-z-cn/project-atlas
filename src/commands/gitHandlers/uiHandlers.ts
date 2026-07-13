import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";

/**
 * UI helper handlers: filesystem open, input/confirm/error/info dialogs,
 * clipboard, system-explorer reveal, and webview-only preference toggles.
 *
 * Extracted from reference project extension.ts. None of these touch git, so
 * none use requireGit. The preference handlers (toggleFavorite /
 * toggleBranchGroupByDirectory / setSingleClickAction / toggleShowTags) are
 * effectively no-ops on the extension host because their state lives in the
 * webview; they remain registered so the protocol contract stays symmetric.
 * navigateToHead is the exception — it fans out a gitStateChanged event with
 * a navigateToHead scope so the graph panel can scroll to the branch tip.
 */
export function registerUiHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle("openFile", async (params) => {
    const filePath = params.filePath as string;
    // Multi-repo: resolve the owning repo root — the caller's params.repoPath
    // wins, then the currently-selected repo, then the legacy workspace root.
    const repoRoot =
      (params?.repoPath as string) ||
      ctx.registry.getCurrentRepoPath() ||
      ctx.workspaceRoot;
    const absPath = repoRoot
      ? vscode.Uri.joinPath(vscode.Uri.file(repoRoot), filePath)
      : vscode.Uri.file(filePath);
    try {
      await vscode.commands.executeCommand("vscode.open", absPath);
    } catch {
      // Fallback for files that can't be opened in any editor
      await vscode.env.openExternal(absPath);
    }
    return { success: true };
  });

  // Show the file's git history in the Git Log panel. Reuses the registered
  // `git-atlas.showFileHistory` command so repo resolution/switching,
  // relativePath computation and the gitLog.focus + broadcastEvent flow stay
  // in one place. Path resolution mirrors openFile above.
  messageRouter.handle("showFileHistory", async (params) => {
    const filePath = params.filePath as string;
    const repoRoot =
      (params?.repoPath as string) ||
      ctx.registry.getCurrentRepoPath() ||
      ctx.workspaceRoot;
    const absUri = repoRoot
      ? vscode.Uri.joinPath(vscode.Uri.file(repoRoot), filePath)
      : vscode.Uri.file(filePath);
    await vscode.commands.executeCommand("git-atlas.showFileHistory", absUri);
    return { success: true };
  });

  messageRouter.handle("showInputBox", async (params) => {
    const prompt = params.prompt as string | undefined;
    const value = params.value as string | undefined;
    const placeHolder = params.placeHolder as string | undefined;
    const result = await vscode.window.showInputBox({
      prompt,
      value,
      placeHolder,
    });
    return { value: result ?? null };
  });

  messageRouter.handle("showConfirmMessage", async (params) => {
    const message = params.message as string;
    const confirmLabel = (params.confirmLabel as string) || "OK";
    const result = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmLabel,
    );
    return { confirmed: result === confirmLabel };
  });

  messageRouter.handle("showErrorNotification", async (params) => {
    const message = params.message as string;
    const actions = (params.actions as string[]) ?? [];
    if (actions.length > 0) {
      const selection = await vscode.window.showErrorMessage(
        message,
        ...actions,
      );
      return { success: true, action: selection ?? null };
    }
    void vscode.window.showErrorMessage(message);
    return { success: true };
  });

  messageRouter.handle("showInfoNotification", async (params) => {
    const message = params.message as string;
    void vscode.window.showInformationMessage(message);
    return { success: true };
  });

  messageRouter.handle("copyToClipboard", async (params) => {
    const text = params.text as string;
    await vscode.env.clipboard.writeText(text);
    return { success: true };
  });

  messageRouter.handle("revealInSystemExplorer", async (params) => {
    const filePath = params.filePath as string;
    if (!filePath || !ctx.workspaceRoot) return { success: false };
    // Multi-repo: resolve the owning repo root for the absolute path.
    const repoRoot =
      (params?.repoPath as string) ||
      ctx.registry.getCurrentRepoPath() ||
      ctx.workspaceRoot;
    const absPath = vscode.Uri.joinPath(
      vscode.Uri.file(repoRoot),
      filePath,
    );
    await vscode.commands.executeCommand("revealFileInOS", absPath);
    return { success: true };
  });

  messageRouter.handle("navigateToHead", async (params) => {
    const branchName = params.branchName as string;
    if (!branchName) return { success: false };
    // Broadcast event to scroll git log to this branch's head commit
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "navigateToHead",
      branch: branchName,
    });
    return { success: true };
  });

  // Navigate from a webview (e.g. the Commit panel's "History" tab) to the
  // Git Log view. Uses the auto-generated `<viewId>.focus` command which both
  // reveals and focuses the git-atlas.gitLog view in the sidebar.
  messageRouter.handle("openGitLogPanel", async () => {
    await vscode.commands.executeCommand("git-atlas.gitLog.focus");
    return { success: true };
  });

  messageRouter.handle("toggleFavorite", async () => {
    // Favorites are UI-only, handled in webview localStorage (per-repo). Host
    // side is a no-op; kept registered so the protocol contract stays symmetric.
    return { success: true };
  });

  // UI preference toggles — state lives in the webview; host side is a no-op.
  messageRouter.handle("toggleBranchGroupByDirectory", async () => {
    return { success: true };
  });

  messageRouter.handle("setSingleClickAction", async () => {
    return { success: true };
  });

  messageRouter.handle("toggleShowTags", async () => {
    return { success: true };
  });
}
