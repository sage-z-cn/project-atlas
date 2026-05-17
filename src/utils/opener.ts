import * as vscode from "vscode";

type OpenMode = "ask" | "currentWindow" | "newWindow";

const MODE_CURRENT = vscode.l10n.t("Open in Current Window");
const MODE_NEW = vscode.l10n.t("Open in New Window");
const MODE_ALWAYS_CURRENT = vscode.l10n.t("Always Open in Current Window");
const MODE_ALWAYS_NEW = vscode.l10n.t("Always Open in New Window");

export async function resolveOpenMode(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("projectExplorer");
  const mode = config.get<OpenMode>("openProjectMode", "ask");

  if (mode === "currentWindow") {return false;}
  if (mode === "newWindow") {return true;}

  const result = await vscode.window.showQuickPick(
    [MODE_CURRENT, MODE_NEW, MODE_ALWAYS_CURRENT, MODE_ALWAYS_NEW],
    { placeHolder: vscode.l10n.t("How would you like to open the project? (Always options can be changed in Settings)") }
  );

  if (!result) {throw new Error("cancelled");}

  if (result === MODE_ALWAYS_CURRENT) {
    await config.update("openProjectMode", "currentWindow", true);
    return false;
  }
  if (result === MODE_ALWAYS_NEW) {
    await config.update("openProjectMode", "newWindow", true);
    return true;
  }
  return result === MODE_NEW;
}

export function openFolder(uri: vscode.Uri, newWindow: boolean): Thenable<boolean> {
  return vscode.commands.executeCommand("vscode.openFolder", uri, newWindow) as Thenable<boolean>;
}
