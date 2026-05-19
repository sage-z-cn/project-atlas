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
    const config = vscode.workspace.getConfiguration("projectAtlas");
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

  /**
   * 生成框选（rubber band selection）的 JS 脚本片段。
   * 需外部保证全局变量 `selecting`, `selStartX`, `selStartY`, `selectedIds`,
   * `focusedId`, `lastClickedId`, `selectionJustMade` 和函数 `render()` 已定义。
   */
  protected static rubberBandScript(containerId: string, itemSelector: string): string {
    const fullSelector = `#${containerId} ${itemSelector}`;
    return `
// --- Rubber band selection ---
const selBox = document.getElementById("sel-box");

document.getElementById("${containerId}").addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (e.target.closest("${itemSelector}")) return;
  if (e.target.closest(".context-menu")) return;

  selecting = true;
  selStartX = e.clientX;
  selStartY = e.clientY;
  selBox.style.display = "block";
  selBox.style.left = e.clientX + "px";
  selBox.style.top = e.clientY + "px";
  selBox.style.width = "0px";
  selBox.style.height = "0px";
});

document.addEventListener("mousemove", (e) => {
  if (!selecting) return;
  const x = Math.min(selStartX, e.clientX);
  const y = Math.min(selStartY, e.clientY);
  const w = Math.abs(e.clientX - selStartX);
  const h = Math.abs(e.clientY - selStartY);
  selBox.style.left = x + "px";
  selBox.style.top = y + "px";
  selBox.style.width = w + "px";
  selBox.style.height = h + "px";

  const boxRect = selBox.getBoundingClientRect();
  document.querySelectorAll("${fullSelector}").forEach(node => {
    const r = node.getBoundingClientRect();
    const hit = !(r.right < boxRect.left || r.left > boxRect.right ||
                  r.bottom < boxRect.top || r.top > boxRect.bottom);
    node.classList.toggle("selecting", hit && w > 0 && h > 0);
  });
});

document.addEventListener("mouseup", (e) => {
  if (!selecting) return;
  selecting = false;
  document.querySelectorAll("${fullSelector}.selecting").forEach(n => n.classList.remove("selecting"));

  const rect = selBox.getBoundingClientRect();
  selBox.style.display = "none";
  if (rect.width < 5 && rect.height < 5) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      selectedIds.clear();
      focusedId = null;
      lastClickedId = null;
    }
    render();
    return;
  }

  const allNodes = document.querySelectorAll("${fullSelector}");
  const ctrl = e.ctrlKey || e.metaKey;

  allNodes.forEach(node => {
    const nodeRect = node.getBoundingClientRect();
    const intersects = !(nodeRect.right < rect.left || nodeRect.left > rect.right ||
                         nodeRect.bottom < rect.top || nodeRect.top > rect.bottom);
    if (!intersects) return;

    const id = node.dataset.id;
    if (ctrl) {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
    } else if (e.shiftKey) {
      selectedIds.add(id);
    } else {
      selectedIds.add(id);
    }
  });

  if (selectedIds.size > 0) {
    const idArr = [...selectedIds];
    focusedId = idArr[idArr.length - 1];
    lastClickedId = focusedId;
  } else {
    focusedId = null;
    lastClickedId = null;
  }
  selectionJustMade = true;
  render();
});
`;
  }
}
