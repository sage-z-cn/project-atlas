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
    favoriteService,
    groupService
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
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) { refreshAll(); }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("projectAtlas.openMode") || e.affectsConfiguration("workbench.list.openMode")) {
        refreshAll();
      }
    })
  );

  // Reveal active file in built-in explorer sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand("project-atlas.revealActiveFile", () => {
      vscode.commands.executeCommand("revealInExplorer");
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
    )
  );

  registerProjectCommands(context, projectService, favoriteService, groupService, refreshAll);
  registerGroupCommands(context, groupService, favoriteService, projectService, refreshAll, favoritesView);

  projectService.recordCurrentWorkspace();
}

export function deactivate() {}
