import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import { getReactWebviewHtml } from "./reactHtml";

/**
 * Opens a "Push Commits" webview panel in an editor tab,
 * similar to IntelliJ IDEA's push dialog.
 */
export class PushPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
  ) {}

  open(
    branchName: string,
    remoteName = "origin",
    withTags = false,
  ): void {
    if (this.panel) {
      this.panel.reveal();
      // Re-send init data
      this.panel.webview.postMessage({
        type: "event",
        event: "pushPanelInit",
        data: { branchName, remoteName, withTags },
      });
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "git-atlas.pushPanel",
      `Push Commits to ${branchName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
        retainContextWhenHidden: false,
      },
    );

    // 新建 panel 时 webview 尚未加载，事件监听器还没注册，初始数据必须
    // 通过 root dataset 透传，App 启动时读取。
    const extra: Record<string, string> = {
      branch: branchName,
      remote: remoteName,
      withTags: String(withTags),
    };

    this.panel.webview.html = getReactWebviewHtml(
      this.panel.webview,
      this.extensionUri,
      "push",
      extra,
      "Git Atlas",
    );

    const routerDisposable = this.messageRouter.registerWebview(
      this.panel.webview,
    );

    this.panel.onDidDispose(() => {
      routerDisposable.dispose();
      this.panel = undefined;
    });
  }

  close(): void {
    this.panel?.dispose();
  }
}
