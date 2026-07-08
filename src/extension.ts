import * as vscode from "vscode";
import { StorageService } from "./services/storageService";
import { ProjectService } from "./services/projectService";
import { FavoriteService } from "./services/favoriteService";
import { GroupService } from "./services/groupService";
import { TaskService } from "./services/taskService";
import { RecentViewProvider } from "./webview/recentViewProvider";
import { FavoritesViewProvider } from "./webview/favoritesViewProvider";
import { TasksViewProvider } from "./webview/tasksViewProvider";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerGroupCommands } from "./commands/groupCommands";
import { setupGit } from "./git/setupGit";

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageService(context);
  const projectService = new ProjectService(storage);
  const favoriteService = new FavoriteService(storage);
  const groupService = new GroupService(storage);
  const taskService = new TaskService();
  taskService.initStorage(context.globalState);

  const recentView = new RecentViewProvider(
    context.extensionUri,
    projectService,
    favoriteService,
    groupService
  );
  const favoritesView = new FavoritesViewProvider(
    context.extensionUri,
    favoriteService,
    groupService,
    projectService
  );
  const tasksView = new TasksViewProvider(
    context.extensionUri,
    taskService,
    projectService,
    favoriteService,
    groupService
  );

  const refreshAll = () => {
    recentView.refresh();
    favoritesView.refresh();
  };

  const refreshTasks = () => {
    tasksView.refresh();
  };

  storage.onDidChange(() => refreshAll());

  // Refresh tasks when task state changes (run/stop)
  taskService.onDidChange(() => refreshTasks());

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        refreshAll();
        refreshTasks();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("projectAtlas.openMode") || e.affectsConfiguration("workbench.list.openMode")) {
        refreshAll();
      }
      if (e.affectsConfiguration("taskAtlas")) {
        refreshTasks();
      }
    })
  );

  // Watch for changes to tasks.json and package.json
  const tasksWatcher = vscode.workspace.createFileSystemWatcher("**/.vscode/tasks.json");
  const pkgWatcher = vscode.workspace.createFileSystemWatcher("**/package.json");
  context.subscriptions.push(tasksWatcher, pkgWatcher);
  const refreshTasksWithCache = () => {
    taskService.invalidateCache();
    refreshTasks();
  };
  context.subscriptions.push(
    tasksWatcher.onDidChange(() => refreshTasksWithCache()),
    tasksWatcher.onDidCreate(() => refreshTasksWithCache()),
    tasksWatcher.onDidDelete(() => refreshTasksWithCache()),
    pkgWatcher.onDidChange(() => refreshTasksWithCache()),
    pkgWatcher.onDidCreate(() => refreshTasksWithCache()),
    pkgWatcher.onDidDelete(() => refreshTasksWithCache()),
  );

  // Reveal active file in built-in explorer sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand("project-atlas.revealActiveFile", () => {
      vscode.commands.executeCommand("revealInExplorer");
    })
  );

  // Refresh tasks command
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.refreshTasks", () => {
      refreshTasks();
    })
  );

  // Open Task Atlas settings
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "taskAtlas");
    })
  );

  // Task Atlas expand / collapse
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.expandAll", () => {
      tasksView.expandAll();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("task-atlas.collapseAll", () => {
      tasksView.collapseAll();
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "project-atlas.recent",
      recentView
    ),
    vscode.window.registerWebviewViewProvider(
      "project-atlas.favorites",
      favoritesView
    ),
    vscode.window.registerWebviewViewProvider(
      "task-atlas.tasks",
      tasksView
    )
  );

  registerProjectCommands(context, projectService, favoriteService, groupService, refreshAll);
  registerGroupCommands(context, groupService, favoriteService, projectService, refreshAll, favoritesView);

  projectService.recordCurrentWorkspace();

  // Cleanup task service on deactivation
  context.subscriptions.push(taskService);

  // Git Atlas 装配（模块化，独立于 atlas 部分）
  void setupGit(context);
}

export function deactivate() {}
