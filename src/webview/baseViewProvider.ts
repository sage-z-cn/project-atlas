import * as vscode from "vscode";

const CLICK_MODES = ["singleClick", "doubleClick", "followIDE"] as const;
type ClickMode = (typeof CLICK_MODES)[number];

export abstract class BaseViewProvider implements vscode.WebviewViewProvider {
  protected view?: vscode.WebviewView;

  constructor(protected readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "ready") {
        this.refresh();
        return;
      }
      this.onMessage(msg);
    });
  }

  protected abstract getHtmlContent(webview: vscode.Webview): string;
  protected abstract onMessage(msg: any): void;
  protected abstract refresh(): void;

  protected resolveClickMode(): "singleClick" | "doubleClick" {
    const config = vscode.workspace.getConfiguration("projectCompass");
    let mode = config.get<string>("openMode", "followIDE") as ClickMode;
    if (mode === "followIDE") {
      const ideMode = vscode.workspace
        .getConfiguration("workbench.list")
        .get<string>("openMode", "singleClick");
      mode = ideMode === "doubleClick" ? "doubleClick" : "singleClick";
    }
    if (!CLICK_MODES.includes(mode as ClickMode)) {
      mode = "singleClick";
    }
    return mode as "singleClick" | "doubleClick";
  }

  protected postMessage(msg: unknown) {
    this.view?.webview.postMessage(msg);
  }

  protected getNonce(): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
