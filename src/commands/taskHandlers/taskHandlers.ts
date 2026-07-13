import * as vscode from "vscode";
import type { MessageRouter } from "../../messages/messageRouter";
import type { TaskService } from "../../services/taskService";
import type { TaskItem } from "../../models/task";

/** Task 子系统 host 上下文。Task 有独立的 MessageRouter（自有 onDidChange）。 */
export interface TaskHandlerContext {
  messageRouter: MessageRouter;
  context: vscode.ExtensionContext;
  taskService: TaskService;
}

/** task router 广播的事件名（webview 端需用相同字符串监听）。 */
export const TASK_EVENTS = {
  /** taskService.onDidChange / watcher 失效 / 窗口聚焦 / taskAtlas 配置变化 → webview 重拉 getTasks。 */
  changed: "tasksChanged",
  /** view/title 命令 task-atlas.expandAll 触发。 */
  expandAll: "expandAllRequested",
  /** view/title 命令 task-atlas.collapseAll 触发。 */
  collapseAll: "collapseAllRequested",
} as const;

export interface TaskItemDto {
  id: string;
  name: string;
  source: "vscode" | "npm";
  isRunning: boolean;
  relativeDir: string;
  cwd: string;
  packageManager: string;
}

export interface TaskProjectDto {
  relativePath: string;
  tasks: TaskItemDto[];
}

export interface TasksDataDto {
  pinnedItems: TaskItemDto[];
  recentItems: TaskItemDto[];
  rootProject: TaskProjectDto;
  projects: TaskProjectDto[];
  /** 根任务段的标签（工作区名，无工作区时 "Root"）。 */
  workspaceName: string;
}

function toDto(t: TaskItem, runningIds: Set<string>): TaskItemDto {
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

/** 根任务段标签：工作区名，无工作区时 "Root"（对齐 legacy tasksViewProvider）。 */
function getWorkspaceName(): string {
  return vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.l10n.t("Root");
}

/** 注册 Task 面板的全部 MessageRouter handler。 */
export function registerTaskHandlers(ctx: TaskHandlerContext): void {
  const { messageRouter, taskService } = ctx;

  messageRouter.handle("getTasks", async (): Promise<TasksDataDto> => {
    try {
      const tasks = await taskService.getTasks();
      const runningIds = new Set(taskService.getRunningTaskIds());

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

      const projects: TaskProjectDto[] = [];
      for (const relPath of [...subProjectMap.keys()].sort()) {
        const projTasks = subProjectMap.get(relPath)!;
        projects.push({
          relativePath: relPath,
          tasks: projTasks.map((t) => toDto(t, runningIds)),
        });
      }

      const rootProject: TaskProjectDto = {
        relativePath: "",
        tasks: rootTasks.map((t) => toDto(t, runningIds)),
      };

      const pinnedIds = new Set(taskService.getPinnedIds());
      const showPinned = taskService.getShowPinned();
      const pinnedItems: TaskItemDto[] = [];
      if (showPinned && pinnedIds.size > 0) {
        for (const t of tasks) {
          if (pinnedIds.has(t.id)) pinnedItems.push(toDto(t, runningIds));
        }
      }

      const recentIds = taskService.getRecentRunIds();
      const showRecent = taskService.getShowRecentRuns();
      const recentItems: TaskItemDto[] = [];
      if (showRecent && recentIds.length > 0) {
        for (const id of recentIds) {
          const task = tasks.find((t) => t.id === id);
          if (task) recentItems.push(toDto(task, runningIds));
        }
      }

      return { pinnedItems, recentItems, rootProject, projects, workspaceName: getWorkspaceName() };
    } catch {
      return {
        pinnedItems: [],
        recentItems: [],
        rootProject: { relativePath: "", tasks: [] },
        projects: [],
        workspaceName: getWorkspaceName(),
      };
    }
  });

  messageRouter.handle("runTask", async (params) => {
    const id = params.id as string;
    if (id) await taskService.runTask(id);
  });

  messageRouter.handle("stopTask", async (params) => {
    const id = params.id as string;
    if (id) taskService.stopTask(id);
  });

  messageRouter.handle("pinTask", async (params) => {
    const id = params.id as string;
    if (id) taskService.pin(id);
  });

  messageRouter.handle("unpinTask", async (params) => {
    const id = params.id as string;
    if (id) taskService.unpin(id);
  });

  messageRouter.handle("removeRecentRun", async (params) => {
    const id = params.id as string;
    if (id) taskService.removeRecentRun(id);
  });

  messageRouter.handle("reorderTasks", async (params) => {
    const dragId = params.dragId as string;
    const targetId = params.targetId as string;
    const position = params.position as string;
    if (dragId && targetId) {
      await taskService.reorder(dragId, targetId, position);
    }
  });
}
