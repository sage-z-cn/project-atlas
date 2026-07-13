import * as vscode from "vscode";
import { MessageRouter } from "../messages/messageRouter";
import { getReactWebviewHtml } from "./reactHtml";

/**
 * React webview 的通用基类。
 *
 * 参考项目 gitLogViewProvider.ts 的 resolveWebviewView（极薄），抽象出 mode + extra
 * 两个可变维度，供 panel/commit/merge/conflicts/push/rollback 各视图复用。
 * MessageRouter.registerWebview 返回 vscode.Disposable，由 webviewView.onDidDispose 统一释放。
 */
export class ReactViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
    private readonly mode: string,
    private readonly title: string = "Atlas",
    private readonly extra: Record<string, string> = {},
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
    };
    webview.html = getReactWebviewHtml(
      webview,
      this.extensionUri,
      this.mode,
      this.extra,
      this.title,
    );
    const disposable = this.messageRouter.registerWebview(webview);
    webviewView.onDidDispose(() => disposable.dispose());
  }
}
