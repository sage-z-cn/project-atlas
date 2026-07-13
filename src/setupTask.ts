import * as vscode from "vscode";
import { MessageRouter } from "./messages/messageRouter";
import { ReactViewProvider } from "./webview/reactViewProvider";
import { registerL10nBundleHandler } from "./messages/l10nHandler";
import {
  registerTaskHandlersAll,
  TASK_EVENTS,
  type TaskHandlerContext,
} from "./commands/taskHandlers";
import type { TaskService } from "./services/taskService";

/**
 * Task Atlas 模块化装配入口。镜像 setupGit/setupProject 结构。
 *
 * Task 有独立的 MessageRouter + 自有 taskService.onDidChange（不经 StorageService）。
 * 从 extension.ts 迁入：tasksWatcher/pkgWatcher（tasks.json/package.json 变更 →
 * invalidateCache + 广播）、task-atlas.* 配置监听、windowState focused、以及
 * view/title 命令（task-atlas.expandAll/collapseAll/refreshTasks）。
 *
 * 事件契约（webview 端用相同字符串监听）：
 *   - tasksChanged：数据/运行态/配置变化 → webview 重拉 getTasks
 *   - expandAllRequested / collapseAllRequested：view/title 命令驱动展开/折叠
 */
export function setupTask(
  context: vscode.ExtensionContext,
  taskService: TaskService,
): void {
  const messageRouter = new MessageRouter();

  registerL10nBundleHandler(messageRouter, context);

  const ctx: TaskHandlerContext = { messageRouter, context, taskService };
  registerTaskHandlersAll(ctx);

  // Tasks 视图（React，mode="tasks"）
  const tasksProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "tasks",
    "Task Atlas",
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("task-atlas.tasks", tasksProvider),
  );

  // taskService 状态变化（run/stop/pin/unpin/reorder + 终端关闭/结束）→ 广播
  context.subscriptions.push(
    taskService.onDidChange(() => {
      messageRouter.broadcastEvent(TASK_EVENTS.changed, {});
    }),
  );

  // watcher：tasks.json / package.json 变更 → 失效缓存 + 广播
  const tasksWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.vscode/tasks.json",
  );
  const pkgWatcher = vscode.workspace.createFileSystemWatcher("**/package.json");
  context.subscriptions.push(tasksWatcher, pkgWatcher);
  const refreshWithCache = (): void => {
    taskService.invalidateCache();
    messageRouter.broadcastEvent(TASK_EVENTS.changed, {});
  };
  context.subscriptions.push(
    tasksWatcher.onDidChange(() => refreshWithCache()),
    tasksWatcher.onDidCreate(() => refreshWithCache()),
    tasksWatcher.onDidDelete(() => refreshWithCache()),
    pkgWatcher.onDidChange(() => refreshWithCache()),
    pkgWatcher.onDidCreate(() => refreshWithCache()),
    pkgWatcher.onDidDelete(() => refreshWithCache()),
  );

  // taskAtlas 配置变化（showPinned/showRecentRuns/maxRecentRuns）→ 广播
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("taskAtlas")) {
        messageRouter.broadcastEvent(TASK_EVENTS.changed, {});
      }
    }),
  );

  // 窗口聚焦 → 广播
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) messageRouter.broadcastEvent(TASK_EVENTS.changed, {});
    }),
  );

  // view/title 命令（manifest 引用，必须保留注册）
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.refreshTasks", () => {
      taskService.invalidateCache();
      messageRouter.broadcastEvent(TASK_EVENTS.changed, {});
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "taskAtlas");
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.expandAll", () => {
      messageRouter.broadcastEvent(TASK_EVENTS.expandAll, {});
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.collapseAll", () => {
      messageRouter.broadcastEvent(TASK_EVENTS.collapseAll, {});
    }),
  );
}
