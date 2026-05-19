import * as vscode from "vscode";
import { BaseViewProvider } from "./baseViewProvider";
import { ProjectService } from "../services/projectService";
import { FavoriteService } from "../services/favoriteService";
import { GroupService } from "../services/groupService";
import { resolveOpenMode, openFolder, openInOS } from "../utils/opener";
import { getProjectTypeIcon } from "../utils/projectTypeDetector";
import type { ProjectType } from "../models/project";

interface RecentItemDto {
  id: string;
  name: string;
  path: string;
  isValid: boolean;
  timeLabel: string;
  icon: string;
  iconSource: "codicon" | "devicon";
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {return vscode.l10n.t("just now");}
  if (minutes < 60) {return vscode.l10n.t("{0} min ago", String(minutes));}
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {return vscode.l10n.t("{0} hr ago", String(hours));}
  const days = Math.floor(hours / 24);
  if (days < 30) {return vscode.l10n.t("{0} days ago", String(days));}
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export class RecentViewProvider extends BaseViewProvider {
  constructor(
    extensionUri: vscode.Uri,
    private projectService: ProjectService,
    private favoriteService: FavoriteService,
    private groupService: GroupService
  ) {
    super(extensionUri);
  }

  refresh() {
    const config = vscode.workspace.getConfiguration("projectAtlas");
    const limit = config.get<number>("recentProjectsLimit", 50);
    const clickMode = this.resolveClickMode();
    const items = this.projectService.getRecent(limit).map(
      (p): RecentItemDto => {
        const iconInfo = getProjectTypeIcon(p.projectType);
        return {
          id: p.id,
          name: p.name,
          path: p.path,
          isValid: p.isValid,
          timeLabel: p.isValid ? formatRelativeTime(p.lastOpenedAt) : vscode.l10n.t("Invalid"),
          icon: iconInfo.icon,
          iconSource: iconInfo.iconSource,
        };
      }
    );
    this.postMessage({ type: "data", items, clickMode });
  }

  protected getHtmlContent(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
    );
    const deviconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'devicon', 'devicon.min.css')
    );
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${codiconCss}" rel="stylesheet" nonce="${nonce}">
<link href="${deviconCss}" rel="stylesheet" nonce="${nonce}">
<style nonce="${nonce}">
  :root { --item-height: 22px; --indent: 8px; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 0;
    user-select: none;
  }
  #list { min-height: 100vh; }
  .item {
    display: flex;
    align-items: flex-start;
    min-height: var(--item-height);
    padding: 4px 8px 4px 8px;
    cursor: pointer;
    overflow: hidden;
  }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .item.active { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground); }
  .item.selected { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground); }
  .item.invalid { opacity: 0.5; }
  .item.selecting { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground); }
  .icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    align-self: center;
  }
  .icon.vscode { color: var(--vscode-icon.foreground); }
  .icon.devicon { font-size: 20px; }
  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    align-self: flex-start;
  }
  .label-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .path {
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desc {
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-left: auto;
    text-align: right;
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
</style>
</head>
<body>
<div id="list"></div>
<div id="sel-box" class="selection-box"></div>
<div id="ctx" class="context-menu"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let items = [];
let focusedId = null;
let selectedIds = new Set();
let lastClickedId = null;
let ctxTargetId = null;
let clickMode = "singleClick";
let clickTimer = null;
let pendingClickId = null;
let selecting = false;
let selStartX = 0, selStartY = 0;
let selectionJustMade = false;

const MENU = {
  project: [
    { action: "openInNewWindow", label: ${JSON.stringify(vscode.l10n.t("Open in New Window"))}, icon: "empty-window" },
    { action: "openInCurrentWindow", label: ${JSON.stringify(vscode.l10n.t("Open in Current Window"))}, icon: "window" },
    { action: "revealInExplorer", label: ${JSON.stringify(vscode.l10n.t("Reveal in File Explorer"))}, icon: "file-directory" },
    { sep: true },
    { action: "addFavorite", label: ${JSON.stringify(vscode.l10n.t("Add to Favorites"))}, icon: "star-empty" },
    { action: "rename", label: ${JSON.stringify(vscode.l10n.t("Rename"))}, icon: "edit" },
    { action: "remove", label: ${JSON.stringify(vscode.l10n.t("Remove"))}, icon: "trash" },
  ],
};

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "data") {
    items = msg.items;
    if (msg.clickMode) { clickMode = msg.clickMode; }
    selectedIds.clear();
    focusedId = null;
    lastClickedId = null;
    render();
  } else if (msg.type === "clearSelection") {
    selectedIds.clear();
    focusedId = null;
    lastClickedId = null;
    render();
  }
});

function render() {
  const list = document.getElementById("list");
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">' + esc(${JSON.stringify(vscode.l10n.t("No recent projects"))}) + '</div>';
    return;
  }
  list.innerHTML = items.map(p => {
    const iconClass = p.iconSource === "devicon" ? p.icon + " colored" : 'codicon codicon-' + p.icon;
    const iconStyle = p.iconSource === "devicon" ? 'icon devicon' : 'icon vscode';
    const isFocused = p.id === focusedId;
    const isSelected = selectedIds.has(p.id) && !isFocused;
    return '<div class="item' + (p.isValid ? '' : ' invalid') + (isFocused ? ' active' : '') +
    (isSelected ? ' selected' : '') +
    '" data-id="' + p.id + '">' +
    '<span class="' + iconStyle + '"><i class="' + iconClass + '"></i></span>' +
    '<div class="content"><div class="label-row"><span class="label">' + esc(p.name) + '</span>' +
    '<span class="desc">' + esc(p.timeLabel) + '</span></div>' +
    '<span class="path">' + esc(p.path) + '</span></div></div>';
  }).join("");
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

document.getElementById("list").addEventListener("click", (e) => {
  const el = e.target.closest(".item");
  if (!el) {return;}
  const id = el.dataset.id;

  if (e.ctrlKey || e.metaKey) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      focusedId = lastClickedId;
    } else {
      selectedIds.add(id);
      focusedId = id;
    }
    lastClickedId = id;
    render();
    return;
  }

  if (e.shiftKey && lastClickedId) {
    const allIds = items.map(p => p.id);
    const anchorIdx = allIds.indexOf(lastClickedId);
    const currentIdx = allIds.indexOf(id);
    if (anchorIdx !== -1 && currentIdx !== -1) {
      const start = Math.min(anchorIdx, currentIdx);
      const end = Math.max(anchorIdx, currentIdx);
      for (let i = start; i <= end; i++) {
        selectedIds.add(allIds[i]);
      }
    }
    focusedId = id;
    render();
    return;
  }

  selectedIds.clear();
  selectedIds.add(id);
  lastClickedId = id;
  focusedId = id;
  render();

  if (clickMode === "singleClick") {
    vscode.postMessage({ type: "open", id });
  } else {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    if (pendingClickId === id) {
      pendingClickId = null;
      vscode.postMessage({ type: "open", id });
    } else {
      pendingClickId = id;
      clickTimer = setTimeout(() => { pendingClickId = null; }, 400);
    }
  }
});

document.addEventListener("contextmenu", (e) => {
  const el = e.target.closest(".item");
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
  ctxTargetId = id;
  showMenu(e.clientX, e.clientY, "project");
});

document.addEventListener("click", (e) => {
  hideMenu();
  if (selectionJustMade) {
    selectionJustMade = false;
    return;
  }
  if (!e.target.closest(".item") && !e.target.closest(".context-menu")) {
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

${BaseViewProvider.rubberBandScript("list", ".item")}

function showMenu(x, y, type) {
  const menu = document.getElementById("ctx");
  const menuItems = MENU[type] || [];
  const multiSelect = selectedIds.size > 1;
  menu.innerHTML = menuItems.map(i =>
    i.sep ? '<div class="separator"></div>'
    : '<div class="menu-item' + (multiSelect && i.action !== "addFavorite" && i.action !== "remove" ? ' disabled' : '') + '" data-action="' + i.action + '"><i class="codicon codicon-' + i.icon + '"></i>' + esc(i.label) + '</div>'
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
  if (!el || el.classList.contains("disabled")) {return;}
  const ids = selectedIds.size > 0 ? [...selectedIds] : (ctxTargetId ? [ctxTargetId] : []);
  vscode.postMessage({ type: "contextAction", id: ctxTargetId, ids: ids, action: el.dataset.action });
  hideMenu();
});
vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }

  protected async onMessage(msg: {
    type: string;
    id?: string;
    ids?: string[];
    action?: string;
  }) {
    if (msg.type === "open" && msg.id) {
      await this.openProject(msg.id);
    } else if (msg.type === "contextAction" && msg.action) {
      const ids = msg.ids?.length ? msg.ids : (msg.id ? [msg.id] : []);
      for (const id of ids) {
        await this.handleContextAction(id, msg.action!);
      }
      this.postMessage({ type: "clearSelection" });
    }
  }

  private async openProject(id: string) {
    const project = this.projectService.getById(id);
    if (!project) {return;}
    const config = vscode.workspace.getConfiguration("projectAtlas");
    const mode = config.get<string>("openProjectMode", "ask");

    if (mode === "currentWindow") {
      await openFolder(vscode.Uri.file(project.path), false);
    } else if (mode === "newWindow") {
      await openFolder(vscode.Uri.file(project.path), true);
    } else {
      try {
        const newWindow = await resolveOpenMode();
        await openFolder(vscode.Uri.file(project.path), newWindow);
      } catch { /* cancelled */ }
    }
  }

  private async handleContextAction(id: string, action: string) {
    const project = this.projectService.getById(id);
    if (!project) {return;}

    switch (action) {
      case "openInNewWindow":
        await openFolder(vscode.Uri.file(project.path), true);
        break;
      case "openInCurrentWindow":
        await openFolder(vscode.Uri.file(project.path), false);
        break;
      case "revealInExplorer":
        openInOS(vscode.Uri.file(project.path));
        break;
      case "addFavorite": {
        const groupId = await this.groupService.pickGroup();
        if (groupId === null) { return; } // user cancelled
        await this.favoriteService.add({
          name: project.name,
          path: project.path,
        }, groupId);
        break;
      }
      case "rename": {
        const newName = await vscode.window.showInputBox({
          prompt: vscode.l10n.t("Rename project"),
          value: project.name,
        });
        if (newName) {
          await this.projectService.renameProject(id, newName);
          await this.favoriteService.rename(id, newName);
        }
        break;
      }
      case "remove": {
        await this.projectService.removeProject(id);
        const favProject = this.favoriteService.getByPath(project.path);
        if (favProject) {
          await this.favoriteService.remove(favProject.id);
        }
        break;
      }
    }
  }

}
