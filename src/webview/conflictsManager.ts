import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import { getGitWebviewHtml } from "./gitHtml";

export class ConflictsManager {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
  ) {}

  openConflictsPanel(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "git-atlas.conflicts",
      "Conflicts",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );

    panel.webview.html = getGitWebviewHtml(
      panel.webview,
      this.extensionUri,
      "conflicts",
    );

    const routerDisposable = this.messageRouter.registerWebview(panel.webview);

    this.panel = panel;
    panel.onDidDispose(() => {
      this.panel = null;
      routerDisposable.dispose();
    });
  }
}
