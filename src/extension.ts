import * as vscode from "vscode";
import { StorageService } from "./services/storageService";
import { ProjectService } from "./services/projectService";
import { FavoriteService } from "./services/favoriteService";
import { GroupService } from "./services/groupService";
import { ProjectTreeProvider } from "./providers/projectTreeProvider";
import { RecentTreeProvider } from "./providers/recentTreeProvider";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerGroupCommands } from "./commands/groupCommands";

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageService(context);
  const projectService = new ProjectService(storage);
  const favoriteService = new FavoriteService(storage);
  const groupService = new GroupService(storage);

  const projectProvider = new ProjectTreeProvider(favoriteService, groupService);
  const recentProvider = new RecentTreeProvider(projectService);

  const refreshAll = () => {
    projectProvider.refresh();
    recentProvider.refresh();
  };

  storage.onDidChange(() => refreshAll());

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "project-explorer.recent",
      recentProvider
    ),
    vscode.window.createTreeView("project-explorer.favorites", {
      treeDataProvider: projectProvider,
      dragAndDropController: projectProvider,
    })
  );

  registerProjectCommands(context, projectService, favoriteService, refreshAll);
  registerGroupCommands(context, groupService, favoriteService, projectService, refreshAll);

  projectService.recordCurrentWorkspace();

  const config = vscode.workspace.getConfiguration("projectExplorer");
  const limit = config.get<number>("recentProjectsLimit", 20);
  projectService.checkValidity(limit);
}

export function deactivate() {}
