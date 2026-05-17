import * as vscode from "vscode";
import { StorageService } from "./services/storageService";
import { ProjectService } from "./services/projectService";
import { GroupService } from "./services/groupService";
import { ProjectTreeProvider } from "./providers/projectTreeProvider";
import { FavoriteTreeProvider } from "./providers/favoriteTreeProvider";
import { RecentTreeProvider } from "./providers/recentTreeProvider";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerGroupCommands } from "./commands/groupCommands";

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageService(context);
  const projectService = new ProjectService(storage);
  const groupService = new GroupService(storage);

  const projectProvider = new ProjectTreeProvider(projectService, groupService);
  const favoriteProvider = new FavoriteTreeProvider(projectService);
  const recentProvider = new RecentTreeProvider(projectService);

  const refreshAll = () => {
    projectProvider.refresh();
    favoriteProvider.refresh();
    recentProvider.refresh();
  };

  storage.onDidChange(() => refreshAll());

  context.subscriptions.push(
    vscode.window.createTreeView("project-explorer.projects", {
      treeDataProvider: projectProvider,
      dragAndDropController: projectProvider,
    }),
    vscode.window.registerTreeDataProvider(
      "project-explorer.favorites",
      favoriteProvider
    ),
    vscode.window.registerTreeDataProvider(
      "project-explorer.recent",
      recentProvider
    )
  );

  registerProjectCommands(context, projectService, refreshAll);
  registerGroupCommands(context, groupService, projectService, refreshAll);

  projectService.recordCurrentWorkspace();

  const config = vscode.workspace.getConfiguration("projectExplorer");
  const limit = config.get<number>("recentProjectsLimit", 20);
  projectService.checkValidity(limit);
}

export function deactivate() {}
