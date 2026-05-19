import * as vscode from "vscode";
import { BaseViewProvider } from "./baseViewProvider";
import { FavoriteService } from "../services/favoriteService";
import { GroupService } from "../services/groupService";
import { ProjectService } from "../services/projectService";
import { resolveOpenMode, openFolder, openInOS } from "../utils/opener";
import { getProjectTypeIcon } from "../utils/projectTypeDetector";
import type { ProjectType } from "../models/project";

interface TreeNodeDto {
  id: string;
  type: "group" | "project";
  name: string;
  path?: string;
  isValid?: boolean;
  icon?: string;
  iconSource?: "codicon" | "devicon";
  children?: TreeNodeDto[];
}

export class FavoritesViewProvider extends BaseViewProvider {
  constructor(
    extensionUri: vscode.Uri,
    private favoriteService: FavoriteService,
    private groupService: GroupService,
    private projectService: ProjectService
  ) {
    super(extensionUri);
  }

  refresh() {
    const tree = this.buildTree();
    const clickMode = this.resolveClickMode();
    this.postMessage({ type: "data", tree, clickMode });
  }

  collapseAll() {
    this.postMessage({ type: "collapseAll" });
  }

  expandAll() {
    this.postMessage({ type: "expandAll" });
  }

  private buildTree(): TreeNodeDto[] {
    const result: TreeNodeDto[] = [];

    const addGroup = (groupId: string): TreeNodeDto => {
      const g = this.groupService.getById(groupId)!;
      const children: TreeNodeDto[] = [];
      for (const child of this.groupService.getChildren(groupId)) {
        children.push(addGroup(child.id));
      }
      for (const p of this.favoriteService.getByGroup(groupId)) {
        const iconInfo = getProjectTypeIcon(p.projectType);
        children.push({
          id: p.id,
          type: "project",
          name: p.name,
          path: p.path,
          isValid: p.isValid,
          icon: iconInfo.icon,
          iconSource: iconInfo.iconSource,
        });
      }
      return { id: g.id, type: "group", name: g.name, children };
    };

    for (const g of this.groupService.getRootGroups()) {
      result.push(addGroup(g.id));
    }
    for (const p of this.favoriteService.getUngrouped()) {
      const iconInfo = getProjectTypeIcon(p.projectType);
      result.push({
        id: p.id,
        type: "project",
        name: p.name,
        path: p.path,
        isValid: p.isValid,
        icon: iconInfo.icon,
        iconSource: iconInfo.iconSource,
      });
    }
    return result;
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
  :root { --item-height: 22px; --indent: 0px; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 4px 0;
    user-select: none;
  }
  #tree { min-height: calc(100vh - 8px); }
  .tree-node {
    display: flex;
    align-items: flex-start;
    min-height: var(--item-height);
    padding: 4px 8px 4px 0;
    cursor: pointer;
    overflow: hidden;
    position: relative;
  }
  .tree-node:hover { background: var(--vscode-list-hoverBackground); }
  .tree-node.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .tree-node.selected { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground); }
  .tree-node.invalid { opacity: 0.5; }
  .tree-node.drag-over-inside { background: var(--vscode-list-focusHighlightForeground); outline: 1px solid var(--vscode-focusBorder); border-radius: 3px; }
  .indent { flex-shrink: 0; position: relative; align-self: stretch; margin: -4px 0; z-index: 1; }
  .indent[data-width="16"] { width: 16px; }
  .indent[data-width="32"] { width: 32px; }
  .indent[data-width="48"] { width: 48px; }
  .indent[data-width="64"] { width: 64px; }
  .indent[data-width="80"] { width: 80px; }
  .indent[data-width="96"] { width: 96px; }
  .indent[data-width="112"] { width: 112px; }
  .indent[data-width="128"] { width: 128px; }
  .indent-guide {
    position: absolute;
    top: 0;
    height: 100%;
    width: 1px;
    background-color: var(--vscode-tree-inactiveIndentGuidesStroke, #808080);
    pointer-events: none;
    z-index: 1;
  }
  .indent-guide[data-level="0"] { left: 8px; }
  .indent-guide[data-level="1"] { left: 24px; }
  .indent-guide[data-level="2"] { left: 40px; }
  .indent-guide[data-level="3"] { left: 56px; }
  .indent-guide[data-level="4"] { left: 72px; }
  .indent-guide[data-level="5"] { left: 88px; }
  .indent-guide[data-level="6"] { left: 104px; }
  .indent-guide[data-level="7"] { left: 120px; }
  .chevron {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
  }
  .icon.folder { color: var(--vscode-icon.foreground); }
  .icon.project { color: var(--vscode-icon.foreground); }
  .icon.devicon { font-size: 16px; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-weight: 600; }
  .tree-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    align-self: flex-start;
  }
  .tree-path {
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .children { overflow: hidden; }
  .children.collapsed { display: none; }
  .drop-indicator {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--vscode-focusBorder);
    pointer-events: none;
    z-index: 100;
  }
  .drop-indicator.before { top: 0; }
  .drop-indicator.after { bottom: 0; }
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
</style>
</head>
<body>
<div id="tree"></div>
<div id="ctx" class="context-menu"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let tree = [];
let expanded = new Set(vscode.getState()?.expanded ?? []);
let focusedId = null;
let selectedIds = new Set();
let lastClickedId = null;
let ctxTarget = null;
let dragData = null;
let currentIndicator = null;
let currentOverNode = null;
let lastDropTarget = null;
let clickMode = "singleClick";
let clickTimer = null;
let pendingClickId = null;

const MENU_PROJECT = [
  { action: "openInNewWindow", label: ${JSON.stringify(vscode.l10n.t("Open in New Window"))}, icon: "empty-window" },
  { action: "openInCurrentWindow", label: ${JSON.stringify(vscode.l10n.t("Open in Current Window"))}, icon: "window" },
  { action: "revealInExplorer", label: ${JSON.stringify(vscode.l10n.t("Reveal in File Explorer"))}, icon: "file-directory" },
  { sep: true },
  { action: "rename", label: ${JSON.stringify(vscode.l10n.t("Rename"))}, icon: "edit" },
  { action: "removeFavorite", label: ${JSON.stringify(vscode.l10n.t("Remove from Favorites"))}, icon: "close" },
];
const MENU_GROUP = [
  { action: "renameGroup", label: ${JSON.stringify(vscode.l10n.t("Rename Group"))}, icon: "edit" },
  { action: "deleteGroup", label: ${JSON.stringify(vscode.l10n.t("Delete Group"))}, icon: "trash" },
];

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "data") {
    tree = msg.tree;
    if (msg.clickMode) { clickMode = msg.clickMode; }
    selectedIds.clear();
    focusedId = null;
    lastClickedId = null;
    render();
  } else if (msg.type === "collapseAll") {
    expanded.clear();
    saveState();
    render();
  } else if (msg.type === "expandAll") {
    function collectGroups(nodes) {
      for (const n of nodes) {
        if (n.type === "group") {
          expanded.add(n.id);
          if (n.children) { collectGroups(n.children); }
        }
      }
    }
    collectGroups(tree);
    saveState();
    render();
  }
});

function render() {
  const container = document.getElementById("tree");
  if (!tree || tree.length === 0) {
    container.innerHTML = '<div class="empty">${JSON.stringify(vscode.l10n.t("No favorites yet"))}</div>';
    return;
  }
  container.innerHTML = renderNodes(tree, 0);
}

function renderNodes(nodes, depth) {
  let html = "";
  for (const node of nodes) {
    const isGroup = node.type === "group";
    const isExpanded = expanded.has(node.id);
    const useDevicon = !isGroup && node.iconSource === "devicon";
    const iconClass = isGroup ? "folder" : (useDevicon ? "project devicon" : "project");
    const iconContent = isGroup
      ? (isExpanded ? "codicon codicon-folder-opened" : "codicon codicon-folder")
      : (useDevicon ? node.icon : "codicon codicon-" + (node.icon || "vscode"));
    const invalidClass = !isGroup && !node.isValid ? " invalid" : "";
    const isFocused = node.id === focusedId;
    const activeClass = isFocused ? " active" : "";
    const selectedClass = selectedIds.has(node.id) && !isFocused ? " selected" : "";
    const projectClass = !isGroup ? " is-project" : "";

    const indentWidth = isGroup ? depth * 16 : (depth + 1) * 16;

    html += '<div class="tree-node' + invalidClass + activeClass + selectedClass + projectClass + '" data-id="' + node.id + '" data-type="' + node.type + '" draggable="true">';
    if (indentWidth > 0) {
      html += '<div class="indent" data-width="' + indentWidth + '">';
      for (let i = 0; i < depth; i++) {
        html += '<div class="indent-guide" data-level="' + i + '"></div>';
      }
      html += '</div>';
    }
    if (isGroup) {
      const chevronCodicon = isExpanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right";
      html += '<span class="chevron" data-toggle="' + node.id + '"><i class="' + chevronCodicon + '"></i></span>';
    }
    html += '<span class="icon ' + iconClass + '"><i class="' + iconContent + '"></i></span>';
    html += '<div class="tree-content"><span class="label">' + esc(node.name) + '</span>';
    if (!isGroup && node.path) {
      html += '<span class="tree-path">' + esc(node.path) + '</span>';
    }
    html += '</div></div>';

    if (isGroup && node.children) {
      html += '<div class="children' + (isExpanded ? '' : ' collapsed') + '" data-parent="' + node.id + '">';
      html += renderNodes(node.children, depth + 1);
      html += '</div>';
    }
  }
  return html;
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function getVisibleNodeIds() {
  const nodes = document.querySelectorAll('#tree .tree-node');
  return Array.from(nodes).map(n => n.dataset.id);
}

document.getElementById("tree").addEventListener("click", (e) => {
  const node = e.target.closest(".tree-node");
  if (!node) {return;}
  const id = node.dataset.id;
  const type = node.dataset.type;

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
    const allIds = getVisibleNodeIds();
    const anchorIdx = allIds.indexOf(lastClickedId);
    const currentIdx = allIds.indexOf(id);
    if (anchorIdx !== -1 && currentIdx !== -1) {
      const start = Math.min(anchorIdx, currentIdx);
      const end = Math.max(anchorIdx, currentIdx);
      for (let i = start; i <= end; i++) {
        if (allIds[i]) { selectedIds.add(allIds[i]); }
      }
    }
    focusedId = id;
    render();
    return;
  }

  if (type === "group") {
    selectedIds.clear();
    selectedIds.add(id);
    focusedId = id;
    lastClickedId = id;
    if (expanded.has(id)) { expanded.delete(id); } else { expanded.add(id); }
    saveState();
    render();
    return;
  }

  if (type === "project") {
    selectedIds.clear();
    selectedIds.add(id);
    focusedId = id;
    lastClickedId = id;
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
  }
});

document.addEventListener("contextmenu", (e) => {
  const node = e.target.closest(".tree-node");
  if (!node) { e.preventDefault(); return; }
  e.preventDefault();
  const id = node.dataset.id;
  if (!selectedIds.has(id)) {
    selectedIds.clear();
    selectedIds.add(id);
    focusedId = id;
    lastClickedId = id;
    render();
  }
  ctxTarget = { id: id, type: node.dataset.type };
  showMenu(e.clientX, e.clientY, node.dataset.type);
});

document.addEventListener("click", (e) => {
  hideMenu();
  if (!e.target.closest(".tree-node") && !e.target.closest(".context-menu")) {
    selectedIds.clear();
    focusedId = null;
    lastClickedId = null;
    render();
  }
});
window.addEventListener("blur", () => { hideMenu(); });

function showMenu(x, y, type) {
  const menu = document.getElementById("ctx");
  const menuItems = type === "group" ? MENU_GROUP : MENU_PROJECT;
  const multiSelect = selectedIds.size > 1;
  menu.innerHTML = menuItems.map(i =>
    i.sep ? '<div class="separator"></div>'
    : '<div class="menu-item' + (multiSelect && i.action !== "removeFavorite" && i.action !== "remove" && i.action !== "deleteGroup" ? ' disabled' : '') + '" data-action="' + i.action + '"><i class="codicon codicon-' + i.icon + '"></i>' + esc(i.label) + '</div>'
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

// Drag and drop
document.getElementById("tree").addEventListener("dragstart", (e) => {
  const node = e.target.closest(".tree-node");
  if (!node) {return;}
  dragData = { id: node.dataset.id, type: node.dataset.type };
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", node.dataset.id);
  node.style.opacity = "0.5";
});

document.getElementById("tree").addEventListener("dragend", (e) => {
  const node = e.target.closest(".tree-node");
  if (node) { node.style.opacity = ""; }
  clearIndicator();
  dragData = null;
  lastDropTarget = null;
});

document.getElementById("tree").addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!dragData) {return;}
  const node = e.target.closest(".tree-node");
  if (!node) {
    // 鼠标不在任何节点上，检查是否在根级别列表底部区域
    const treeContainer = document.getElementById("tree");
    // 只查找根级别节点（#tree 的直接子元素中的 .tree-node）
    const rootNodes = Array.from(treeContainer.children).filter(el => el.classList.contains("tree-node"));
    
    if (rootNodes.length > 0) {
      const lastRootNode = rootNodes[rootNodes.length - 1];
      const lastRect = lastRootNode.getBoundingClientRect();
      
      // 如果鼠标在最后一个根节点下方
      if (e.clientY >= lastRect.bottom) {
        clearIndicator();
        currentOverNode = lastRootNode;
        lastDropTarget = { id: lastRootNode.dataset.id, type: lastRootNode.dataset.type, position: "after" };

        const ind = document.createElement("div");
        ind.className = "drop-indicator after";
        lastRootNode.appendChild(ind);
        currentIndicator = ind;
        return;
      }
    }

    clearIndicator();
    return;
  }

  // Don't allow dropping on self
  if (node.dataset.id === dragData.id) { clearIndicator(); return; }

  const rect = node.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const h = rect.height;
  const isGroup = node.dataset.type === "group";
  let position;

  if (isGroup) {
    if (y < h * 0.25) { position = "before"; }
    else if (y > h * 0.75) { position = "after"; }
    else { position = "inside"; }
  } else {
    position = y < h / 2 ? "before" : "after";
  }

  // Don't allow dropping group inside project
  if (dragData.type === "group" && position === "inside" && !isGroup) {
    clearIndicator(); return;
  }

  // Don't allow dropping project inside project
  if (dragData.type === "project" && position === "inside" && !isGroup) {
    clearIndicator(); return;
  }

  clearIndicator();
  currentOverNode = node;
  lastDropTarget = { id: node.dataset.id, type: node.dataset.type, position };

  if (position === "inside") {
    node.classList.add("drag-over-inside");
  } else {
    const ind = document.createElement("div");
    ind.className = "drop-indicator " + position;
    node.appendChild(ind);
    currentIndicator = ind;
  }
});

document.getElementById("tree").addEventListener("dragleave", (e) => {
  const node = e.target.closest(".tree-node");
  if (node && node === currentOverNode) { clearIndicator(); }
});

document.getElementById("tree").addEventListener("drop", (e) => {
  e.preventDefault();
  if (!dragData || !lastDropTarget) {return;}

  vscode.postMessage({
    type: "drop",
    drag: dragData,
    target: { id: lastDropTarget.id, type: lastDropTarget.type },
    position: lastDropTarget.position,
  });

  clearIndicator();
  dragData = null;
  lastDropTarget = null;
});

function saveState() {
  vscode.setState({ expanded: [...expanded] });
}

function clearIndicator() {
  if (currentIndicator) { currentIndicator.remove(); currentIndicator = null; }
  if (currentOverNode) { currentOverNode.classList.remove("drag-over-inside"); currentOverNode = null; }
}
vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }

  protected async onMessage(msg: {
    type: string;
    id?: string;
    ids?: string[];
    itemType?: string;
    action?: string;
    drag?: { id: string; type: string };
    target?: { id: string; type: string };
    position?: string;
  }) {
    switch (msg.type) {
      case "open":
        if (msg.id) { await this.openProject(msg.id); }
        break;
      case "drop":
        if (msg.drag && msg.target && msg.position) {
          await this.handleDrop(msg.drag, msg.target, msg.position);
        }
        break;
      case "contextAction":
        if (msg.action) {
          const ids = msg.ids?.length ? msg.ids : (msg.id ? [msg.id] : []);
          const isBatch = ids.length > 1;
          for (const id of ids) {
            const isGroup = this.groupService.getById(id);
            const itemType = isGroup ? "group" : "project";
            let effectiveAction = msg.action;
            if (isGroup && msg.action === "removeFavorite") {
              effectiveAction = "deleteGroup";
            } else if (!isGroup && msg.action === "deleteGroup") {
              effectiveAction = "removeFavorite";
            }
            await this.handleContextAction(id, itemType, effectiveAction, isBatch);
          }
          this.postMessage({ type: "clearSelection" });
        }
        break;
    }
  }

  private async openProject(id: string) {
    const project = this.favoriteService.getById(id);
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

  private async handleDrop(
    drag: { id: string; type: string },
    target: { id: string; type: string },
    position: string
  ) {
    if (drag.id === target.id) {return;}

    if (drag.type === "project") {
      await this.dropProject(drag.id, target, position);
    } else if (drag.type === "group") {
      await this.dropGroup(drag.id, target, position);
    }
  }

  private async dropProject(
    projectId: string,
    target: { id: string; type: string },
    position: string
  ) {
    if (position === "inside" && target.type === "group") {
      await this.favoriteService.moveToGroup(projectId, target.id);
    } else if (target.type === "project") {
      if (position === "before") {
        await this.favoriteService.reorderAfter(projectId, target.id);
      } else if (position === "after") {
        const targetProject = this.favoriteService.getById(target.id);
        if (targetProject) {
          const siblings = targetProject.groupId 
            ? this.favoriteService.getByGroup(targetProject.groupId)
            : this.favoriteService.getUngrouped();
          const idx = siblings.findIndex((p) => p.id === target.id);
          if (idx >= 0 && idx < siblings.length - 1) {
            await this.favoriteService.reorderAfter(projectId, siblings[idx + 1].id);
          } else {
            await this.favoriteService.moveToGroup(projectId, targetProject.groupId);
          }
        }
      }
    } else if (target.type === "group") {
      if (position === "before" || position === "after") {
        const targetGroup = this.groupService.getById(target.id);
        if (targetGroup) {
          await this.favoriteService.moveToGroup(
            projectId,
            targetGroup.parentId || undefined
          );
        }
      }
    }
  }

  private async dropGroup(
    groupId: string,
    target: { id: string; type: string },
    position: string
  ) {
    if (position === "inside" && target.type === "group") {
      if (this.groupService.isDescendant(target.id, groupId)) {return;}
      await this.groupService.updateParent(groupId, target.id);
    } else if (position === "before" || position === "after") {
      if (target.type === "group") {
        const targetGroup = this.groupService.getById(target.id);
        if (!targetGroup) {return;}
        if (this.groupService.isDescendant(target.id, groupId)) {return;}
        const dragged = this.groupService.getById(groupId);
        if (dragged && dragged.parentId === targetGroup.parentId) {
          if (position === "before") {
            await this.groupService.reorderAfter(groupId, target.id);
          } else {
            const siblings = targetGroup.parentId 
              ? this.groupService.getChildren(targetGroup.parentId)
              : this.groupService.getRootGroups();
            const idx = siblings.findIndex((g) => g.id === target.id);
            if (idx >= 0 && idx < siblings.length - 1) {
              await this.groupService.reorderAfter(groupId, siblings[idx + 1].id);
            } else {
              await this.groupService.updateParent(groupId, targetGroup.parentId || undefined);
              const orderSiblings = targetGroup.parentId
                ? this.groupService.getChildren(targetGroup.parentId)
                : this.groupService.getRootGroups();
              const maxOrder = orderSiblings
                .filter(g => g.id !== groupId)
                .reduce((max, g) => Math.max(max, g.order), -1);
              await this.groupService.updateOrder(groupId, maxOrder + 1);
            }
          }
        } else {
          await this.groupService.updateParent(
            groupId,
            targetGroup.parentId || undefined
          );
        }
      } else {
        // Dropped near a project at root level
        await this.groupService.updateParent(groupId, undefined);
        const rootGroups = this.groupService.getRootGroups().filter(g => g.id !== groupId);
        const maxOrder = rootGroups.reduce((max, g) => Math.max(max, g.order), -1);
        await this.groupService.updateOrder(groupId, maxOrder + 1);
      }
    }
  }

  private async handleContextAction(
    id: string,
    itemType: string,
    action: string,
    skipConfirm = false
  ) {
    if (itemType === "group") {
      await this.handleGroupAction(id, action, skipConfirm);
    } else {
      await this.handleProjectAction(id, action);
    }
  }

  private async handleProjectAction(id: string, action: string) {
    const project = this.favoriteService.getById(id) || this.projectService.getById(id);
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
      case "removeFavorite":
        await this.favoriteService.remove(id);
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
        await this.favoriteService.remove(id);
        const recentProject = this.projectService.getByPath(project.path);
        if (recentProject) {
          await this.projectService.removeProject(recentProject.id);
        }
        break;
      }
    }
  }

  private async handleGroupAction(id: string, action: string, skipConfirm = false) {
    switch (action) {
      case "renameGroup": {
        if (skipConfirm) {return;}
        const group = this.groupService.getById(id);
        if (!group) {return;}
        const newName = await vscode.window.showInputBox({
          prompt: vscode.l10n.t("Rename group"),
          value: group.name,
        });
        if (newName) {
          await this.groupService.renameGroup(id, newName);
        }
        break;
      }
      case "deleteGroup": {
        const group = this.groupService.getById(id);
        if (!group) {return;}
        const projects = this.favoriteService.getByGroup(id);
        const children = this.groupService.getChildren(id);
        if (projects.length > 0 || children.length > 0) {
          if (skipConfirm) {
            await this.groupService.deleteGroup(id, false);
          } else {
            const act = await vscode.window.showWarningMessage(
              vscode.l10n.t("Group '{0}' contains items. What would you like to do?", group.name),
              { modal: true },
              vscode.l10n.t("Move to parent"),
              vscode.l10n.t("Remove all from favorites")
            );
            if (!act) {return;}
            await this.groupService.deleteGroup(id, act === vscode.l10n.t("Move to parent"));
          }
        } else {
          await this.groupService.deleteGroup(id, true);
        }
        break;
      }
    }
  }
}
