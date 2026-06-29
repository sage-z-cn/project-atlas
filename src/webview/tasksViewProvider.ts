import * as vscode from "vscode";
import { BaseViewProvider } from "./baseViewProvider";
import { TaskService } from "../services/taskService";
import { ProjectService } from "../services/projectService";
import { FavoriteService } from "../services/favoriteService";
import { GroupService } from "../services/groupService";
import type { TaskItem } from "../models/task";

interface TaskItemDto {
  id: string;
  name: string;
  source: "vscode" | "npm";
  isRunning: boolean;
  relativeDir: string;
  cwd: string;
  packageManager: string;
}

interface TaskProjectDto {
  relativePath: string;
  tasks: TaskItemDto[];
}

export class TasksViewProvider extends BaseViewProvider {
  constructor(
    extensionUri: vscode.Uri,
    private taskService: TaskService,
    projectService: ProjectService,
    favoriteService: FavoriteService,
    groupService: GroupService
  ) {
    super(extensionUri, projectService, favoriteService, groupService);
  }

  refresh() {
    this.refreshAsync();
  }

  expandAll() {
    this.postMessage({ type: "expandAll" });
  }

  collapseAll() {
    this.postMessage({ type: "collapseAll" });
  }

  private async refreshAsync() {
    try {
    const tasks = await this.taskService.getTasks();
    const runningIds = new Set(this.taskService.getRunningTaskIds());

    // Split root vs sub-project tasks
    const rootTasks: TaskItem[] = [];
    const subProjectMap = new Map<string, TaskItem[]>();

    for (const t of tasks) {
      if (t.relativeDir === "") {
        rootTasks.push(t);
      } else {
        let list = subProjectMap.get(t.relativeDir);
        if (!list) {
          list = [];
          subProjectMap.set(t.relativeDir, list);
        }
        list.push(t);
      }
    }

    // Build sub-project DTOs (flat task list per project, no group sub-grouping)
    const projects: TaskProjectDto[] = [];
    const sortedPaths = [...subProjectMap.keys()].sort();
    for (const relPath of sortedPaths) {
      const projTasks = subProjectMap.get(relPath)!;
      projects.push({
        relativePath: relPath,
        tasks: projTasks.map(t => this.toDto(t, runningIds)),
      });
    }

    // Root tasks as a pseudo-project (always visible)
    const rootProject: TaskProjectDto = {
      relativePath: "",
      tasks: rootTasks.map(t => this.toDto(t, runningIds)),
    };

    // Build pinned tasks list
    const pinnedIds = new Set(this.taskService.getPinnedIds());
    const showPinned = this.taskService.getShowPinned();
    let pinnedItems: TaskItemDto[] = [];
    if (showPinned && pinnedIds.size > 0) {
      for (const t of tasks) {
        if (pinnedIds.has(t.id)) {
          pinnedItems.push(this.toDto(t, runningIds));
        }
      }
    }

    // Build recent runs list
    const recentIds = this.taskService.getRecentRunIds();
    const showRecent = this.taskService.getShowRecentRuns();
    let recentItems: TaskItemDto[] = [];
    if (showRecent && recentIds.length > 0) {
      for (const id of recentIds) {
        const task = tasks.find(t => t.id === id);
        if (task) {
          recentItems.push(this.toDto(task, runningIds));
        }
      }
    }

    this.postMessage({ type: "data", pinnedItems, recentItems, rootProject, projects });
    } catch {
      this.postMessage({ type: "data", pinnedItems: [], recentItems: [], rootProject: { relativePath: "", tasks: [] }, projects: [] });
    }
  }

  private toDto(t: TaskItem, runningIds: Set<string>): TaskItemDto {
    return {
      id: t.id,
      name: t.name,
      source: t.source,
      isRunning: runningIds.has(t.id),
      relativeDir: t.relativeDir,
      cwd: t.cwd,
      packageManager: t.packageManager,
    };
  }

  protected getHtmlContent(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );
    const deviconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "node_modules", "devicon", "devicon.min.css")
    );
    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || vscode.l10n.t("Root");

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
  .group-header {
    display: flex;
    align-items: center;
    min-height: var(--item-height);
    padding: 4px 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.9em;
    text-transform: uppercase;
    color: var(--vscode-foreground);
    letter-spacing: 0.5px;
    gap: 4px;
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .group-header .chevron,
  .group-header .icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .section-separator {
    height: 1px;
    margin: 6px 12px;
    background: var(--vscode-widget-border, rgba(255,255,255,0.1));
  }
  .group-children { overflow: hidden; }
  .group-children.collapsed { display: none; }
  .project-header {
    display: flex;
    align-items: center;
    min-height: var(--item-height);
    padding: 4px 8px;
    cursor: pointer;
    font-weight: 600;
    color: var(--vscode-foreground);
    gap: 4px;
  }
  .project-header:hover { background: var(--vscode-list-hoverBackground); }
  .project-header .chevron,
  .project-header .icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .project-header .icon { color: var(--vscode-icon-foreground); }
  .project-children { overflow: hidden; }
  .project-children.collapsed { display: none; }
  .project-indent {
    flex-shrink: 0;
    width: 14px;
  }
  .task-item {
    display: flex;
    align-items: center;
    min-height: var(--item-height);
    padding: 4px 8px;
    cursor: pointer;
    overflow: hidden;
    gap: 6px;
    position: relative;
  }
  .task-item:hover { background: var(--vscode-list-hoverBackground); }
  .task-item.running { color: var(--vscode-notificationsInfoIcon-foreground, #3794ff); }
  .task-item.drag-over { background: var(--vscode-list-focusHighlightForeground); outline: 1px solid var(--vscode-focusBorder); border-radius: 3px; }
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
  .task-item .icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-icon-foreground);
  }
  .task-item .icon.devicon { font-size: 14px; }
  .task-item .task-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-path {
    margin-left: 6px;
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
    opacity: 0.8;
  }
  .task-item .run-btn,
  .task-item .stop-btn {
    flex-shrink: 0;
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
  .task-item .run-btn:hover,
  .task-item .stop-btn:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground);
  }
  .task-item .loading-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0 2px;
    color: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
    display: flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    width: 20px;
  }
  .task-item .run-btn .codicon,
  .task-item .stop-btn .codicon {
    font-size: 13px;
  }
  .task-item.running .stop-btn {
    color: var(--vscode-notificationsErrorIcon-foreground, #f14c4c);
  }
  .context-menu {
    position: fixed;
    background: var(--vscode-menu-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
    border-radius: 4px;
    padding: 4px 0;
    z-index: 1000;
    min-width: 160px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .context-menu .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 20px 4px 10px;
    cursor: pointer;
    font-size: var(--vscode-font-size);
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    white-space: nowrap;
  }
  .context-menu .menu-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
    color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
  }
  .context-menu .menu-item.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .context-menu .menu-item .codicon {
    font-size: 14px;
    flex-shrink: 0;
  }
  .context-menu .separator {
    height: 1px;
    margin: 4px 0;
    background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  }
  .empty {
    padding: 8px 16px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 0;
    gap: 8px;
    color: var(--vscode-descriptionForeground);
    font-size: var(--vscode-font-size);
  }
  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--vscode-descriptionForeground);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  ${BaseViewProvider.sharedCss()}
</style>
</head>
<body>
<div id="list"><div class="loading"><div class="loading-spinner"></div>${vscode.l10n.t("Loading tasks...")}</div></div>
<div id="ctx" class="context-menu" style="display:none"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let rootProject = { relativePath: "", tasks: [] };
let projects = [];
let pinnedItems = [];
let recentItems = [];
let pinnedIds = new Set();
const RUN_LABEL = ${JSON.stringify(vscode.l10n.t("Run"))};
const STOP_LABEL = ${JSON.stringify(vscode.l10n.t("Stop"))};
const PIN_LABEL = ${JSON.stringify(vscode.l10n.t("Pin"))};
const UNPIN_LABEL = ${JSON.stringify(vscode.l10n.t("Unpin"))};
const REMOVE_RECENT_LABEL = ${JSON.stringify(vscode.l10n.t("Remove from recent"))};
const PINNED_LABEL = ${JSON.stringify(vscode.l10n.t("Pinned"))};
const RECENT_RUNS_LABEL = ${JSON.stringify(vscode.l10n.t("Recent Runs"))};
const ROOT_LABEL = ${JSON.stringify(workspaceName)};
let expandedProjects = new Set(vscode.getState()?.expandedProjects ?? undefined);
let expandedPinned = vscode.getState()?.expandedPinned ?? true;
let expandedRecent = vscode.getState()?.expandedRecent ?? true;
let firstLoad = (vscode.getState()?.expandedProjects === undefined);

function saveState() {
  vscode.setState({ expandedProjects: [...expandedProjects], expandedPinned, expandedRecent });
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "data") {
    rootProject = msg.rootProject || { relativePath: "", tasks: [] };
    projects = msg.projects || [];
    pinnedItems = msg.pinnedItems || [];
    recentItems = msg.recentItems || [];
    pinnedIds = new Set(pinnedItems.map(t => t.id));
    if (firstLoad) {
      if (rootProject.tasks.length > 0 && projects.length > 0) {
        expandedProjects.add(rootProject.relativePath);
      }
      for (const p of projects) { expandedProjects.add(p.relativePath); }
      firstLoad = false;
      saveState();
    }
    render();
  } else if (msg.type === "expandAll") {
    expandedPinned = true;
    expandedRecent = true;
    if (rootProject.tasks.length > 0 && projects.length > 0) {
      expandedProjects.add(rootProject.relativePath);
    }
    for (const p of projects) { expandedProjects.add(p.relativePath); }
    saveState();
    render();
  } else if (msg.type === "collapseAll") {
    expandedPinned = false;
    expandedRecent = false;
    expandedProjects.clear();
    saveState();
    render();
  }
});
vscode.postMessage({ type: "ready" });

function render() {
  const list = document.getElementById("list");
  const hasContent = pinnedItems.length > 0 || recentItems.length > 0 || rootProject.tasks.length > 0 || projects.length > 0;
  if (!hasContent) {
    list.innerHTML = '<div class="empty">' + esc(${JSON.stringify(vscode.l10n.t("No tasks found"))}) + '</div>';
    return;
  }

  let html = "";

  // Pinned group (always first)
  if (pinnedItems.length > 0) {
    const isExpanded = expandedPinned;
    const chevronClass = isExpanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right";
    html += '<div class="group-header" data-group="__pinned__">';
    html += '<span class="chevron"><i class="' + chevronClass + '"></i></span>';
    html += '<span class="icon"><i class="codicon codicon-pinned"></i></span>';
    html += esc(PINNED_LABEL);
    html += '</div>';
    html += '<div class="group-children' + (isExpanded ? '' : ' collapsed') + '" data-group-children="__pinned__">';
    for (const task of pinnedItems) {
      html += renderTask(task, true, true);
    }
    html += '</div>';
    if (recentItems.length > 0 || projects.length > 0 || rootProject.tasks.length > 0) {
      html += '<div class="section-separator"></div>';
    }
  }

  // Recent Runs group (second)
  if (recentItems.length > 0) {
    const isExpanded = expandedRecent;
    const chevronClass = isExpanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right";
    html += '<div class="group-header" data-group="__recent__">';
    html += '<span class="chevron"><i class="' + chevronClass + '"></i></span>';
    html += '<span class="icon"><i class="codicon codicon-clock"></i></span>';
    html += esc(RECENT_RUNS_LABEL);
    html += '</div>';
    html += '<div class="group-children' + (isExpanded ? '' : ' collapsed') + '" data-group-children="__recent__">';
    for (const task of recentItems) {
      html += renderTask(task, true, true);
    }
    html += '</div>';
    if (projects.length > 0 || rootProject.tasks.length > 0) {
      html += '<div class="section-separator"></div>';
    }
  }

  // Root project tasks (shown as project if sub-projects exist, flat otherwise)
  if (rootProject.tasks.length > 0) {
    if (projects.length > 0) {
      const isExpanded = expandedProjects.has(rootProject.relativePath);
      const chevronClass = isExpanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right";
      const folderIcon = isExpanded ? "codicon codicon-folder-opened" : "codicon codicon-folder";
      html += '<div class="project-header" data-project="' + esc(rootProject.relativePath) + '">';
      html += '<span class="chevron"><i class="' + chevronClass + '"></i></span>';
      html += '<span class="icon"><i class="' + folderIcon + '"></i></span>';
      html += esc(ROOT_LABEL);
      html += '</div>';
      html += '<div class="project-children' + (isExpanded ? '' : ' collapsed') + '" data-project-children="' + esc(rootProject.relativePath) + '">';
      for (const task of rootProject.tasks) {
        html += renderTask(task, true, false);
      }
      html += '</div>';
      if (projects.length > 0) {
        html += '<div class="section-separator"></div>';
      }
    } else {
      for (const task of rootProject.tasks) {
        html += renderTask(task, false, false);
      }
    }
  }

  // Sub-projects
  for (const project of projects) {
    const isExpanded = expandedProjects.has(project.relativePath);
    const chevronClass = isExpanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right";
    const folderIcon = isExpanded ? "codicon codicon-folder-opened" : "codicon codicon-folder";
    html += '<div class="project-header" data-project="' + esc(project.relativePath) + '">';
    html += '<span class="chevron"><i class="' + chevronClass + '"></i></span>';
    html += '<span class="icon"><i class="' + folderIcon + '"></i></span>';
    html += esc(project.relativePath);
    html += '</div>';
    html += '<div class="project-children' + (isExpanded ? '' : ' collapsed') + '" data-project-children="' + esc(project.relativePath) + '">';
    for (const task of project.tasks) {
      html += renderTask(task, true, false);
    }
    html += '</div>';
  }

  list.innerHTML = html;
}

function renderTask(task, inProject, showPath) {
  const runningClass = task.isRunning ? " running" : "";
  const iconClass = task.source === "npm"
    ? "devicon devicon-npm-original-wordmark colored"
    : "codicon codicon-terminal";
  const iconHtml = task.source === "npm"
    ? '<span class="icon ' + iconClass + '"></span>'
    : '<span class="icon"><i class="' + iconClass + '"></i></span>';
  const actionBtn = task.isRunning
    ? '<button class="stop-btn" data-task-id="' + esc(task.id) + '" title="' + esc(STOP_LABEL) + '"><i class="codicon codicon-debug-stop"></i></button>'
    : '<button class="run-btn" data-task-id="' + esc(task.id) + '" title="' + esc(RUN_LABEL) + '"><i class="codicon codicon-play"></i></button>';
  const projectIndent = inProject ? '<span class="project-indent"></span>' : '';

  let displayName = esc(task.name);
  if (showPath && task.relativeDir) {
    displayName += '<span class="task-path">' + esc(task.relativeDir) + '</span>';
  }

  const cmd = task.source === "npm"
    ? task.packageManager + " run " + task.name
    : task.name;
  const tooltip = esc(cmd + "\\n" + task.cwd);

  return '<div class="task-item' + runningClass + '" data-id="' + esc(task.id) + '" draggable="true" title="' + tooltip + '">' +
    projectIndent +
    iconHtml +
    '<span class="task-name">' + displayName + '</span>' +
    actionBtn +
    '</div>';
}

${BaseViewProvider.escFunction()}

// Click handlers
document.getElementById("list").addEventListener("click", (e) => {
  const actionBtn = e.target.closest(".run-btn, .stop-btn");
  if (actionBtn) {
    const taskId = actionBtn.dataset.taskId;
    if (actionBtn.classList.contains("run-btn")) {
      actionBtn.classList.remove("run-btn");
      actionBtn.classList.add("loading-btn");
      actionBtn.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';
      actionBtn.disabled = true;
      vscode.postMessage({ type: "run", id: taskId });
    } else {
      vscode.postMessage({ type: "stop", id: taskId });
    }
    return;
  }

  const projectHeader = e.target.closest(".project-header");
  if (projectHeader) {
    const projectPath = projectHeader.dataset.project;
    if (expandedProjects.has(projectPath)) {
      expandedProjects.delete(projectPath);
    } else {
      expandedProjects.add(projectPath);
    }
    saveState();
    render();
    return;
  }

  const groupHeader = e.target.closest(".group-header");
  if (groupHeader) {
    const groupName = groupHeader.dataset.group;
    if (groupName === "__pinned__") {
      expandedPinned = !expandedPinned;
      saveState();
      render();
      return;
    }
    if (groupName === "__recent__") {
      expandedRecent = !expandedRecent;
      saveState();
      render();
      return;
    }
    return;
  }
});

// Drag and drop
let dragTaskId = null;
let currentIndicator = null;
let currentOverNode = null;
let lastDropTarget = null;

document.getElementById("list").addEventListener("dragstart", (e) => {
  const taskItem = e.target.closest(".task-item");
  if (!taskItem) { return; }
  dragTaskId = taskItem.dataset.id;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", taskItem.dataset.id);
  taskItem.style.opacity = "0.5";
});

document.getElementById("list").addEventListener("dragend", (e) => {
  const taskItem = e.target.closest(".task-item");
  if (taskItem) { taskItem.style.opacity = ""; }
  clearIndicator();
  dragTaskId = null;
  lastDropTarget = null;
});

document.getElementById("list").addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!dragTaskId) { return; }
  const taskItem = e.target.closest(".task-item");
  if (!taskItem) { clearIndicator(); return; }
  if (taskItem.dataset.id === dragTaskId) { clearIndicator(); return; }
  const rect = taskItem.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const h = rect.height;
  const position = y < h / 2 ? "before" : "after";
  clearIndicator();
  currentOverNode = taskItem;
  lastDropTarget = { id: taskItem.dataset.id, position };
  const ind = document.createElement("div");
  ind.className = "drop-indicator " + position;
  taskItem.appendChild(ind);
  currentIndicator = ind;
});

document.getElementById("list").addEventListener("dragleave", (e) => {
  const taskItem = e.target.closest(".task-item");
  if (taskItem && taskItem === currentOverNode) { clearIndicator(); }
});

document.getElementById("list").addEventListener("drop", (e) => {
  e.preventDefault();
  if (!dragTaskId || !lastDropTarget) { return; }
  vscode.postMessage({
    type: "reorder",
    dragId: dragTaskId,
    targetId: lastDropTarget.id,
    position: lastDropTarget.position,
  });
  clearIndicator();
  dragTaskId = null;
  lastDropTarget = null;
});

function clearIndicator() {
  if (currentIndicator) { currentIndicator.remove(); currentIndicator = null; }
  if (currentOverNode) { currentOverNode = null; }
}
// Context menu
let ctxTargetId = null;

document.getElementById("list").addEventListener("contextmenu", (e) => {
  const taskItem = e.target.closest(".task-item");
  if (!taskItem) { return; }
  e.preventDefault();
  const taskId = taskItem.dataset.id;
  ctxTargetId = taskId;
  const isRunning = taskItem.classList.contains("running");
  const isPinned = pinnedIds.has(taskId);
  const recentGroup = taskItem.closest("[data-group-children='__recent__']");
  const inRecent = !!recentGroup;
  const items = [];
  if (!isRunning) {
    items.push({ action: "run", icon: "play", label: RUN_LABEL });
  } else {
    items.push({ action: "stop", icon: "debug-stop", label: STOP_LABEL });
  }
  items.push({ sep: true });
  if (!isPinned) {
    items.push({ action: "pin", icon: "pin", label: PIN_LABEL });
  } else {
    items.push({ action: "unpin", icon: "pinned", label: UNPIN_LABEL });
  }
  if (inRecent) {
    items.push({ action: "removeRecent", icon: "close", label: REMOVE_RECENT_LABEL });
  }
  showCtxMenu(e.clientX, e.clientY, items);
});

function showCtxMenu(x, y, items) {
  const menu = document.getElementById("ctx");
  menu.innerHTML = items.map(i =>
    i.sep ? '<div class="separator"></div>'
    : '<div class="menu-item" data-action="' + i.action + '"><i class="codicon codicon-' + i.icon + '"></i>' + esc(i.label) + '</div>'
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

function hideCtxMenu() {
  document.getElementById("ctx").style.display = "none";
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".context-menu")) { hideCtxMenu(); }
});

window.addEventListener("blur", () => { hideCtxMenu(); });

document.getElementById("ctx").addEventListener("click", (e) => {
  const item = e.target.closest(".menu-item");
  if (!item || !ctxTargetId) { return; }
  const action = item.dataset.action;
  if (action) {
    vscode.postMessage({ type: action, id: ctxTargetId });
  }
  hideCtxMenu();
});

vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }

  protected async onMessage(msg: {
    type: string;
    id?: string;
    dragId?: string;
    targetId?: string;
    position?: string;
  }) {
    switch (msg.type) {
      case "run":
        if (msg.id) {
          await this.taskService.runTask(msg.id);
        }
        break;
      case "stop":
        if (msg.id) {
          this.taskService.stopTask(msg.id);
        }
        break;
      case "pin":
        if (msg.id) {
          this.taskService.pin(msg.id);
        }
        break;
      case "unpin":
        if (msg.id) {
          this.taskService.unpin(msg.id);
        }
        break;
      case "removeRecent":
        if (msg.id) {
          this.taskService.removeRecentRun(msg.id);
        }
        break;
      case "reorder":
        if (msg.dragId && msg.targetId) {
          await this.taskService.reorder(msg.dragId, msg.targetId, msg.position);
          this.refresh();
        }
        break;
    }
  }
}
