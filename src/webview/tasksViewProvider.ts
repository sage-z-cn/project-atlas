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
  group?: string;
  isRunning: boolean;
}

interface TaskGroupDto {
  name: string;
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
    const tasks = this.taskService.getTasks();
    const runningIds = new Set(this.taskService.getRunningTaskIds());

    // Group tasks
    const groups: TaskGroupDto[] = [];
    const ungrouped: TaskItemDto[] = [];
    const groupMap = new Map<string, TaskItemDto[]>();

    for (const t of tasks) {
      const dto: TaskItemDto = {
        id: t.id,
        name: t.name,
        source: t.source,
        group: t.group,
        isRunning: runningIds.has(t.id),
      };

      if (t.group) {
        let list = groupMap.get(t.group);
        if (!list) {
          list = [];
          groupMap.set(t.group, list);
        }
        list.push(dto);
      } else {
        ungrouped.push(dto);
      }
    }

    for (const [name, tasks] of groupMap) {
      groups.push({ name, tasks });
    }

    this.postMessage({ type: "data", groups, ungrouped });
  }

  protected getHtmlContent(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${codiconCss}" rel="stylesheet" nonce="${nonce}">
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
    color: var(--vscode-descriptionForeground);
    letter-spacing: 0.5px;
    gap: 4px;
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .group-header .chevron {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .group-children { overflow: hidden; }
  .group-children.collapsed { display: none; }
  .group-indent {
    flex-shrink: 0;
    width: 20px;
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
  .task-item .task-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .task-item .run-btn .codicon,
  .task-item .stop-btn .codicon {
    font-size: 13px;
  }
  .task-item.running .stop-btn {
    color: var(--vscode-notificationsErrorIcon-foreground, #f14c4c);
  }
  .empty {
    padding: 8px 16px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  ${BaseViewProvider.sharedCss()}
</style>
</head>
<body>
<div id="list"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let groups = [];
let ungrouped = [];
const RUN_LABEL = ${JSON.stringify(vscode.l10n.t("Run"))};
const STOP_LABEL = ${JSON.stringify(vscode.l10n.t("Stop"))};
let expandedGroups = new Set(vscode.getState()?.expandedGroups ?? undefined);
let firstLoad = (vscode.getState()?.expandedGroups === undefined);

function saveState() {
  vscode.setState({ expandedGroups: [...expandedGroups] });
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "data") {
    groups = msg.groups || [];
    ungrouped = msg.ungrouped || [];
    if (firstLoad) {
      for (const g of groups) { expandedGroups.add(g.name); }
      firstLoad = false;
      saveState();
    }
    render();
  }
});

function render() {
  const list = document.getElementById("list");
  const hasContent = groups.length > 0 || ungrouped.length > 0;
  if (!hasContent) {
    list.innerHTML = '<div class="empty">' + esc(${JSON.stringify(vscode.l10n.t("No tasks found"))}) + '</div>';
    return;
  }

  let html = "";

  for (const group of groups) {
    const isExpanded = expandedGroups.has(group.name);
    const chevronClass = isExpanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right";
    html += '<div class="group-header" data-group="' + esc(group.name) + '">';
    html += '<span class="chevron"><i class="' + chevronClass + '"></i></span>';
    html += esc(group.name);
    html += '</div>';
    html += '<div class="group-children' + (isExpanded ? '' : ' collapsed') + '" data-group-children="' + esc(group.name) + '">';
    for (const task of group.tasks) {
      html += renderTask(task, true);
    }
    html += '</div>';
  }

  for (const task of ungrouped) {
    html += renderTask(task, false);
  }

  list.innerHTML = html;
}

function renderTask(task, inGroup) {
  const runningClass = task.isRunning ? " running" : "";
  const iconClass = task.source === "npm"
    ? "codicon codicon-terminal"
    : "codicon codicon-gear";
  const actionBtn = task.isRunning
    ? '<button class="stop-btn" data-task-id="' + esc(task.id) + '" title="' + esc(STOP_LABEL) + '"><i class="codicon codicon-debug-stop"></i></button>'
    : '<button class="run-btn" data-task-id="' + esc(task.id) + '" title="' + esc(RUN_LABEL) + '"><i class="codicon codicon-play"></i></button>';
  const indent = inGroup ? '<span class="group-indent"></span>' : '';

  return '<div class="task-item' + runningClass + '" data-id="' + esc(task.id) + '" draggable="true">' +
    indent +
    '<span class="icon"><i class="' + iconClass + '"></i></span>' +
    '<span class="task-name">' + esc(task.name) + '</span>' +
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
      vscode.postMessage({ type: "run", id: taskId });
    } else {
      vscode.postMessage({ type: "stop", id: taskId });
    }
    return;
  }

  const groupHeader = e.target.closest(".group-header");
  if (groupHeader) {
    const groupName = groupHeader.dataset.group;
    if (expandedGroups.has(groupName)) {
      expandedGroups.delete(groupName);
    } else {
      expandedGroups.add(groupName);
    }
    saveState();
    render();
    return;
  }

  const taskItem = e.target.closest(".task-item");
  if (taskItem) {
    const taskId = taskItem.dataset.id;
    const isRunning = taskItem.classList.contains("running");
    if (isRunning) {
      vscode.postMessage({ type: "stop", id: taskId });
    } else {
      vscode.postMessage({ type: "run", id: taskId });
    }
  }
});

// Drag and drop (same pattern as favoritesView)
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
      case "reorder":
        if (msg.dragId && msg.targetId) {
          this.taskService.reorder(msg.dragId, msg.targetId, msg.position);
          this.refresh();
        }
        break;
    }
  }
}
