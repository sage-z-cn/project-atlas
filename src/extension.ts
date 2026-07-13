import * as vscode from "vscode";
import { StorageService } from "./services/storageService";
import { ProjectService } from "./services/projectService";
import { FavoriteService } from "./services/favoriteService";
import { GroupService } from "./services/groupService";
import { TaskService } from "./services/taskService";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerGroupCommands } from "./commands/groupCommands";
import { setupProject } from "./setupProject";
import { setupTask } from "./setupTask";
import { setupGit } from "./git/setupGit";

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageService(context);
  const projectService = new ProjectService(storage);
  const favoriteService = new FavoriteService(storage);
  const groupService = new GroupService(storage);
  const taskService = new TaskService();
  taskService.initStorage(context.globalState);

  // Recent / Favorites / Tasks 全部迁移到 React。storage.onDidChange 与
  // openMode/config 变更由 setupProject 广播 projectDataChanged/openModeChanged
  // 驱动 recent+favorites 重拉；tasks 由 setupTask 的 tasksChanged 驱动。
  // refreshAll 现为空操作，仅保留签名以最小化 projectCommands/groupCommands 改动。
  const refreshAll = () => {};

  // Reveal active file in built-in explorer sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand("project-atlas.revealActiveFile", () => {
      vscode.commands.executeCommand("revealInExplorer");
    }),
  );

  // Project Atlas 装配（Recent + Favorites React 化；project router + 事件广播）
  setupProject(context, storage, projectService, favoriteService, groupService);

  // Task Atlas 装配（React 化；task router + watcher + view/title 命令）
  setupTask(context, taskService);

  registerProjectCommands(context, projectService, favoriteService, groupService, refreshAll);
  registerGroupCommands(context, groupService, favoriteService, projectService, refreshAll);

  projectService.recordCurrentWorkspace();

  // Cleanup task service on deactivation
  context.subscriptions.push(taskService);

  // Git Atlas 装配（模块化，独立于 atlas 部分）
  void setupGit(context);
}

export function deactivate() {}
