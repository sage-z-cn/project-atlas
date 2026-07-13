import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import { getReactWebviewHtml } from "./reactHtml";

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
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
      },
    );

    panel.webview.html = getReactWebviewHtml(
      panel.webview,
      this.extensionUri,
      "conflicts",
      undefined,
      "Git Atlas",
    );

    const routerDisposable = this.messageRouter.registerWebview(panel.webview);

    this.panel = panel;
    panel.onDidDispose(() => {
      this.panel = null;
      routerDisposable.dispose();
    });
  }
}
