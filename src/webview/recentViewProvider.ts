import * as vscode from "vscode";
import { BaseViewProvider } from "./baseViewProvider";
import { ProjectService } from "../services/projectService";
import { FavoriteService } from "../services/favoriteService";
import { GroupService } from "../services/groupService";
import { openFolder, openInOS } from "../utils/opener";
import { getProjectTypeIcon } from "../utils/projectTypeDetector";
import { confirmDelete } from "../utils/confirm";
import { isPathValid } from "../utils/validator";
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
    projectService: ProjectService,
    favoriteService: FavoriteService,
    groupService: GroupService
  ) {
    super(extensionUri, projectService, favoriteService, groupService);
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
  .icon.vscode { color: var(--vscode-icon-foreground); }
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
  .path-row .path {
    flex: 1;
    min-width: 0;
  }
  .item:hover .hover-actions {
    visibility: visible;
  }
  ${BaseViewProvider.sharedCss()}
</style>
</head>
<body>
<div id="list"></div>
<div id="sel-box" class="selection-box"></div>
<div id="ctx" class="context-menu"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let items = [];
${BaseViewProvider.sharedStateVars()}
let ctxTarget = null;

const MENU = {
  project: [
    { action: "openInNewWindow", label: ${JSON.stringify(vscode.l10n.t("Open in New Window"))}, icon: "link-external" },
    { action: "openInCurrentWindow", label: ${JSON.stringify(vscode.l10n.t("Open in Current Window"))}, icon: "open-in-product" },
    { action: "revealInExplorer", label: ${JSON.stringify(vscode.l10n.t("Reveal in File Explorer"))}, icon: "file-directory" },
    { action: "copyPath", label: ${JSON.stringify(vscode.l10n.t("Copy Path"))}, icon: "copy" },
    { sep: true },
    { action: "addFavorite", label: ${JSON.stringify(vscode.l10n.t("Add to Favorites"))}, icon: "star-empty", multi: true },
    { action: "rename", label: ${JSON.stringify(vscode.l10n.t("Rename"))}, icon: "edit" },
    { action: "remove", label: ${JSON.stringify(vscode.l10n.t("Remove"))}, icon: "trash", multi: true },
  ],
};

window.addEventListener("message", (e) => {
  const msg = e.data;
  ${BaseViewProvider.messageDataHandler("items")}
  else if (msg.type === "clearSelection") {
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
    '<div class="path-row"><span class="path">' + esc(p.path) + '</span>' +
    '<div class="hover-actions">' +
    '<button data-action="openInNewWindow" title="${vscode.l10n.t("Open in New Window")}"><i class="codicon codicon-link-external"></i></button>' +
    '<button data-action="openInCurrentWindow" title="${vscode.l10n.t("Open in Current Window")}"><i class="codicon codicon-open-in-product"></i></button>' +
    '<button data-action="addFavorite" title="${vscode.l10n.t("Add to Favorites")}"><i class="codicon codicon-star-empty"></i></button>' +
    '<button data-action="remove" title="${vscode.l10n.t("Remove")}"><i class="codicon codicon-trash"></i></button>' +
    '</div></div></div></div>';
  }).join("");
}

${BaseViewProvider.escFunction()}

document.getElementById("list").addEventListener("click", (e) => {
  const actionBtn = e.target.closest(".hover-actions button");
  if (actionBtn) {
    const item = actionBtn.closest(".item");
    if (item) {
      vscode.postMessage({ type: "contextAction", id: item.dataset.id, ids: [item.dataset.id], action: actionBtn.dataset.action });
    }
    return;
  }
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

${BaseViewProvider.contextMenuScript(".item")}

${BaseViewProvider.rubberBandScript("list", ".item")}
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
      const isBatch = ids.length > 1;
      // For batch destructive actions, confirm once before the loop
      if (isBatch && msg.action === "remove") {
        if (!await confirmDelete(
          vscode.l10n.t("Are you sure you want to remove {0} selected items?", String(ids.length))
        )) {
          return;
        }
      }
      for (const id of ids) {
        await this.handleContextAction(id, msg.action!, isBatch);
      }
      this.postMessage({ type: "clearSelection" });
    }
  }

  private async openProject(id: string) {
    const project = this.projectService.getById(id);
    if (!project) {return;}
    await this.openProjectByPath(project.path, async () => { await this.handleMissingProject(project); });
  }

  private async handleContextAction(id: string, action: string, skipConfirm = false) {
    const project = this.projectService.getById(id);
    if (!project) {return;}

    switch (action) {
      case "openInNewWindow":
        if (!isPathValid(project.path)) {
          await this.handleMissingProject(project);
          return;
        }
        await openFolder(vscode.Uri.file(project.path), true);
        break;
      case "openInCurrentWindow":
        if (!isPathValid(project.path)) {
          await this.handleMissingProject(project);
          return;
        }
        await openFolder(vscode.Uri.file(project.path), false);
        break;
      case "revealInExplorer":
        openInOS(vscode.Uri.file(project.path));
        break;
      case "copyPath":
        await vscode.env.clipboard.writeText(project.path);
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
      case "rename":
        await this.renameProject(id);
        break;
      case "remove": {
        if (!skipConfirm && !await confirmDelete(vscode.l10n.t("Are you sure you want to remove '{0}'?", project.name))) {
          break;
        }
        await this.removeProjectFromBoth(project.path);
        break;
      }
    }
  }

}
