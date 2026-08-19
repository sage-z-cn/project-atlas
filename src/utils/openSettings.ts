import * as vscode from "vscode";

/**
 * Open the Settings editor showing ALL settings of this extension
 * (filter `@ext:sagez.project-atlas`), not just one panel's namespace.
 */
export function openExtensionSettings(): void {
  vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "@ext:sagez.project-atlas",
  );
}
