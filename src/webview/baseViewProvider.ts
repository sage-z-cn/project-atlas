import * as vscode from "vscode";
import { resolveOpenMode, openFolder } from "../utils/opener";
import { isPathValid } from "../utils/validator";
import { ProjectService } from "../services/projectService";
import { FavoriteService } from "../services/favoriteService";
import { GroupService } from "../services/groupService";

const CLICK_MODES = ["singleClick", "doubleClick", "followIDE"] as const;
type ClickMode = (typeof CLICK_MODES)[number];

export abstract class BaseViewProvider implements vscode.WebviewViewProvider {
  protected view?: vscode.WebviewView;

  constructor(
    protected readonly extensionUri: vscode.Uri,
    protected readonly projectService: ProjectService,
    protected readonly favoriteService: FavoriteService,
    protected readonly groupService: GroupService
  ) {}

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

  // --- Shared business logic ---

  protected async openProjectByPath(
    projectPath: string,
    onMissing: () => Promise<void>
  ): Promise<void> {
    if (!isPathValid(projectPath)) {
      await onMissing();
      return;
    }
    const config = vscode.workspace.getConfiguration("projectAtlas");
    const mode = config.get<string>("openProjectMode", "ask");

    if (mode === "currentWindow") {
      await openFolder(vscode.Uri.file(projectPath), false);
    } else if (mode === "newWindow") {
      await openFolder(vscode.Uri.file(projectPath), true);
    } else {
      try {
        const newWindow = await resolveOpenMode();
        await openFolder(vscode.Uri.file(projectPath), newWindow);
      } catch { /* cancelled */ }
    }
  }

  protected async removeProjectFromBoth(path: string): Promise<void> {
    const favProject = this.favoriteService.getByPath(path);
    if (favProject) {
      await this.favoriteService.remove(favProject.id);
    }
    const recentProject = this.projectService.getByPath(path);
    if (recentProject) {
      await this.projectService.removeProject(recentProject.id);
    }
  }

  protected async renameProject(id: string): Promise<void> {
    const project = this.projectService.getById(id) || this.favoriteService.getById(id);
    if (!project) { return; }
    const newName = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Rename project"),
      value: project.name,
    });
    if (newName) {
      await this.projectService.renameProject(id, newName);
      await this.favoriteService.rename(id, newName);
    }
  }

  protected async handleMissingProject(project: { id: string; name: string; path: string }): Promise<boolean> {
    const remove = vscode.l10n.t("Remove");
    const result = await vscode.window.showWarningMessage(
      vscode.l10n.t("Directory '{0}' does not exist.", project.name),
      { modal: true },
      remove,
    );
    if (result === remove) {
      await this.removeProjectFromBoth(project.path);
      return true;
    }
    return false;
  }

  // --- Shared CSS ---

  protected static sharedCss(): string {
    return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  .icon.devicon { font-size: 20px; }
  .hover-actions {
    visibility: hidden;
    flex-shrink: 0;
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  .hover-actions button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    color: var(--vscode-descriptionForeground);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    width: 20px;
  }
  .hover-actions button:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground);
  }
  .hover-actions .codicon {
    font-size: 13px;
  }
  .empty {
    padding: 8px 16px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  .context-menu {
    display: none;
    position: fixed;
    z-index: 1000;
    background: var(--vscode-menu-background);
    border: 1px solid var(--vscode-menu-border);
    border-radius: 4px;
    padding: 2px 0;
    min-width: 140px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .context-menu .menu-item {
    padding: 2px 16px;
    cursor: pointer;
    white-space: nowrap;
    font-size: 0.9em;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .context-menu .menu-item .codicon { font-size: 14px; }
  .context-menu .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .context-menu .menu-item.disabled { opacity: 0.4; pointer-events: none; }
  .context-menu .separator { height: 1px; background: var(--vscode-menu-separatorBackground); margin: 2px 0; }
  .selection-box {
    display: none;
    position: fixed;
    border: 1px solid var(--vscode-focusBorder);
    pointer-events: none;
    z-index: 999;
  }
  .selection-box::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--vscode-focusBorder);
    opacity: 0.1;
  }
  .path-row {
    display: flex;
    align-items: center;
    min-width: 0;
  }
`;
  }

  // --- Shared JS ---

  protected static sharedStateVars(): string {
    return `let focusedId = null;
let selectedIds = new Set();
let lastClickedId = null;
let clickMode = "singleClick";
let clickTimer = null;
let pendingClickId = null;
let selecting = false;
let selStartX = 0, selStartY = 0;
let selectionJustMade = false;
`;
  }

  protected static escFunction(): string {
    return `function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
`;
  }

  protected static contextMenuScript(itemSelector: string): string {
    return `document.addEventListener("contextmenu", (e) => {
  const el = e.target.closest("${itemSelector}");
  if (!el) { e.preventDefault(); return; }
  e.preventDefault();
  const id = el.dataset.id;
  if (!selectedIds.has(id)) {
    selectedIds.clear();
    selectedIds.add(id);
    focusedId = id;
    lastClickedId = id;
    render();
  }
  const type = el.dataset.type || "project";
  ctxTarget = { id: id, type: type };
  showMenu(e.clientX, e.clientY, type);
});

document.addEventListener("click", (e) => {
  hideMenu();
  if (selectionJustMade) {
    selectionJustMade = false;
    return;
  }
  if (!e.target.closest("${itemSelector}") && !e.target.closest(".context-menu")) {
    selectedIds.clear();
    focusedId = null;
    lastClickedId = null;
    render();
  }
});

window.addEventListener("blur", () => {
  hideMenu();
  if (selecting) {
    selecting = false;
    selBox.style.display = "none";
  }
  selectedIds.clear();
  focusedId = null;
  lastClickedId = null;
  render();
});

function showMenu(x, y, type) {
  const menu = document.getElementById("ctx");
  const menuItems = MENU[type] || [];
  const multiSelect = selectedIds.size > 1;
  menu.innerHTML = menuItems.map(i =>
    i.sep ? '<div class="separator"></div>'
    : '<div class="menu-item' + (multiSelect && !i.multi ? ' disabled' : '') + '" data-action="' + i.action + '"><i class="codicon codicon-' + i.icon + '"></i>' + esc(i.label) + '</div>'
  ).join("");
  menu.style.display = "block";
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  const pad = 4;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (x + menuW > vw - pad) { x = vw - menuW - pad; }
  if (y + menuH > vh - pad) { y = vh - menuH - pad; }
  if (x < pad) { x = pad; }
  if (y < pad) { y = pad; }
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function hideMenu() { document.getElementById("ctx").style.display = "none"; }

document.getElementById("ctx").addEventListener("click", (e) => {
  const el = e.target.closest(".menu-item");
  if (!el || !ctxTarget || el.classList.contains("disabled")) {return;}
  const ids = selectedIds.size > 0 ? [...selectedIds] : (ctxTarget.id ? [ctxTarget.id] : []);
  vscode.postMessage({ type: "contextAction", id: ctxTarget.id, ids: ids, itemType: ctxTarget.type, action: el.dataset.action });
  hideMenu();
});
`;
  }

  protected static messageDataHandler(dataVarName: string): string {
    return `if (msg.type === "data") {
    ${dataVarName} = msg.${dataVarName};
    if (msg.clickMode) { clickMode = msg.clickMode; }
    selectedIds.clear();
    focusedId = null;
    lastClickedId = null;
    render();
  }`;
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
