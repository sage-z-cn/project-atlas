import * as vscode from "vscode";
import { StorageService } from "./services/storageService";
import { ProjectService } from "./services/projectService";
import { FavoriteService } from "./services/favoriteService";
import { GroupService } from "./services/groupService";
import { RecentViewProvider } from "./webview/recentViewProvider";
import { FavoritesViewProvider } from "./webview/favoritesViewProvider";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerGroupCommands } from "./commands/groupCommands";

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageService(context);
  const projectService = new ProjectService(storage);
  const favoriteService = new FavoriteService(storage);
  const groupService = new GroupService(storage);

  const recentView = new RecentViewProvider(
    context.extensionUri,
    projectService,
    favoriteService
  );
  const favoritesView = new FavoritesViewProvider(
    context.extensionUri,
    favoriteService,
    groupService,
    projectService
  );

  const refreshAll = () => {
    recentView.refresh();
    favoritesView.refresh();
  };

  storage.onDidChange(() => refreshAll());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "project-explorer.recent",
      recentView
    ),
    vscode.window.registerWebviewViewProvider(
      "project-explorer.favorites",
      favoritesView
    )
  );

  registerProjectCommands(context, projectService, favoriteService, refreshAll);
  registerGroupCommands(context, groupService, favoriteService, projectService, refreshAll, favoritesView);

  projectService.recordCurrentWorkspace();

  const config = vscode.workspace.getConfiguration("projectExplorer");
  const limit = config.get<number>("recentProjectsLimit", 20);
  projectService.checkValidity(limit);
}

export function deactivate() {}
