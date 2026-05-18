import * as vscode from "vscode";
import { BaseViewProvider } from "./baseViewProvider";
import { ProjectService } from "../services/projectService";
import { FavoriteService } from "../services/favoriteService";
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
    private favoriteService: FavoriteService
  ) {
    super(extensionUri);
  }

  refresh() {
    const config = vscode.workspace.getConfiguration("projectExplorer");
    const limit = config.get<number>("recentProjectsLimit", 20);
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
    padding: 4px 0;
    user-select: none;
  }
  .item {
    display: flex;
    align-items: flex-start;
    min-height: var(--item-height);
    padding: 4px 8px 4px 8px;
    cursor: pointer;
    overflow: hidden;
  }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .item.invalid { opacity: 0.5; }
  .icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    align-self: center;
  }
  .icon.vscode { color: var(--vscode-icon.foreground); }
  .icon.devicon { font-size: 16px; }
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
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .context-menu .menu-item {
    padding: 4px 24px;
    cursor: pointer;
    white-space: nowrap;
  }
  .context-menu .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .context-menu .separator { height: 1px; background: var(--vscode-menu-separatorBackground); margin: 4px 0; }
</style>
</head>
<body>
<div id="list"></div>
<div id="ctx" class="context-menu"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let items = [];
let activeId = null;
let ctxTargetId = null;
let clickMode = "singleClick";
let clickTimer = null;
let pendingClickId = null;

const MENU = {
  project: [
    { action: "openInNewWindow", label: ${JSON.stringify(vscode.l10n.t("Open in New Window"))} },
    { action: "openInCurrentWindow", label: ${JSON.stringify(vscode.l10n.t("Open in Current Window"))} },
    { action: "revealInExplorer", label: ${JSON.stringify(vscode.l10n.t("Reveal in File Explorer"))} },
    { sep: true },
    { action: "addFavorite", label: ${JSON.stringify(vscode.l10n.t("Add to Favorites"))} },
    { action: "rename", label: ${JSON.stringify(vscode.l10n.t("Rename"))} },
    { action: "remove", label: ${JSON.stringify(vscode.l10n.t("Remove"))} },
  ],
};

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "data") {
    items = msg.items;
    if (msg.clickMode) { clickMode = msg.clickMode; }
    render();
  }
});

function render() {
  const list = document.getElementById("list");
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">${JSON.stringify(vscode.l10n.t("No recent projects"))}</div>';
    return;
  }
  list.innerHTML = items.map(p => {
    const iconClass = p.iconSource === "devicon" ? p.icon : 'codicon codicon-' + p.icon;
    const iconStyle = p.iconSource === "devicon" ? 'icon devicon' : 'icon vscode';
    return '<div class="item' + (p.isValid ? '' : ' invalid') + (p.id === activeId ? ' active' : '') +
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
  activeId = id;
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

document.getElementById("list").addEventListener("contextmenu", (e) => {
  const el = e.target.closest(".item");
  if (!el) {return;}
  e.preventDefault();
  ctxTargetId = el.dataset.id;
  showMenu(e.clientX, e.clientY, "project");
});

document.addEventListener("click", () => { hideMenu(); });

function showMenu(x, y, type) {
  const menu = document.getElementById("ctx");
  const items = MENU[type] || [];
  menu.innerHTML = items.map(i =>
    i.sep ? '<div class="separator"></div>'
    : '<div class="menu-item" data-action="' + i.action + '">' + esc(i.label) + '</div>'
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
  if (!el) {return;}
  vscode.postMessage({ type: "contextAction", id: ctxTargetId, action: el.dataset.action });
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
    action?: string;
  }) {
    if (msg.type === "open" && msg.id) {
      await this.openProject(msg.id);
    } else if (msg.type === "contextAction" && msg.id && msg.action) {
      await this.handleContextAction(msg.id, msg.action);
    }
  }

  private async openProject(id: string) {
    const project = this.projectService.getById(id);
    if (!project) {return;}
    const config = vscode.workspace.getConfiguration("projectExplorer");
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
      case "addFavorite":
        await this.favoriteService.add({
          name: project.name,
          path: project.path,
        });
        break;
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
