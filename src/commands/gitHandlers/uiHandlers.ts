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
    const absPath = ctx.workspaceRoot
      ? vscode.Uri.joinPath(vscode.Uri.file(ctx.workspaceRoot), filePath)
      : vscode.Uri.file(filePath);
    try {
      await vscode.commands.executeCommand("vscode.open", absPath);
    } catch {
      // Fallback for files that can't be opened in any editor
      await vscode.env.openExternal(absPath);
    }
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
    const absPath = vscode.Uri.joinPath(
      vscode.Uri.file(ctx.workspaceRoot),
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

  messageRouter.handle("toggleFavorite", async (params) => {
    const branchName = params.branchName as string;
    // Favorites are a UI-only concept, handled in webview state
    void vscode.window.showInformationMessage(
      `Toggled favorite: ${branchName}`,
    );
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
