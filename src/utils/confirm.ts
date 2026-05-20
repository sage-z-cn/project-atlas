import * as vscode from "vscode";

/**
 * Show a modal confirmation dialog for destructive actions.
 * Respects the `projectAtlas.confirmDelete` setting ("ask" | "never").
 * When the user picks "Don't Ask Again", the setting is persisted globally.
 *
 * @returns `true` if the action should proceed, `false` if cancelled.
 */
export async function confirmDelete(message: string): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("projectAtlas");
  const confirmMode = config.get<string>("confirmDelete", "ask");
  if (confirmMode !== "ask") {
    return true;
  }
  const confirm = vscode.l10n.t("Confirm");
  const dontAsk = vscode.l10n.t("Don't Ask Again");
  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    confirm,
    dontAsk
  );
  if (!result) {
    return false;
  }
  if (result === dontAsk) {
    await config.update("confirmDelete", "never", vscode.ConfigurationTarget.Global);
  }
  return true;
}
