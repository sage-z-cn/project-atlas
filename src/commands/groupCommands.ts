import * as vscode from "vscode";
import { GroupService } from "../services/groupService";
import { FavoriteService } from "../services/favoriteService";
import { ProjectService } from "../services/projectService";
import type { GroupItem } from "../models/group";
import type { FavoritesViewProvider } from "../webview/favoritesViewProvider";

type GroupNode = { type: "group"; item: GroupItem };

export function registerGroupCommands(
  context: vscode.ExtensionContext,
  groupService: GroupService,
  favoriteService: FavoriteService,
  projectService: ProjectService,
  refreshAll: () => void,
  favoritesView: FavoritesViewProvider
): void {
  const register = (cmd: string, handler: (...args: any[]) => any) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(`project-atlas.${cmd}`, handler)
    );
  };

  register("addGroup", addGroupCmd);
  register("renameGroup", renameGroupCmd);
  register("deleteGroup", deleteGroupCmd);
  register("collapseAll", collapseAllCmd);
  register("expandAll", expandAllCmd);
  register("cleanInvalid", cleanInvalidCmd);
  register("openSettings", openSettingsCmd);
  register("addCurrentToFavorites", addCurrentToFavoritesCmd);

  async function addGroupCmd() {
    const name = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Enter group name"),
    });
    if (!name) {return;}
    await groupService.addGroup(name);
    refreshAll();
  }

  async function renameGroupCmd(node: GroupNode) {
    if (node?.type !== "group" || !node.item) {return;}
    const newName = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Rename group"),
      value: node.item.name,
    });
    if (!newName) {return;}
    await groupService.renameGroup(node.item.id, newName);
    refreshAll();
  }

  async function deleteGroupCmd(node: GroupNode) {
    if (node?.type !== "group" || !node.item) {return;}

    const projects = favoriteService.getByGroup(node.item.id);
    const children = groupService.getChildren(node.item.id);

    if (projects.length > 0 || children.length > 0) {
      const action = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Group '{0}' contains items. What would you like to do?",
          node.item.name
        ),
        { modal: true },
        vscode.l10n.t("Move to parent"),
        vscode.l10n.t("Remove all from favorites")
      );
      if (!action) {return;}
      await groupService.deleteGroup(node.item.id, action === vscode.l10n.t("Move to parent"));
    } else {
      await groupService.deleteGroup(node.item.id, true);
    }

    refreshAll();
  }

  function collapseAllCmd() {
    favoritesView.collapseAll();
  }

  function expandAllCmd() {
    favoritesView.expandAll();
  }

  async function cleanInvalidCmd() {
    const removedRecent = await projectService.cleanInvalid();
    // TODO: clean invalid from favorites too

    if (removedRecent === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("No invalid projects found.")
      );
      return;
    }

    vscode.window.showInformationMessage(
      vscode.l10n.t("Removed {0} invalid project(s).", String(removedRecent))
    );
    refreshAll();
  }

  function openSettingsCmd() {
    vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "projectAtlas"
    );
  }

  async function addCurrentToFavoritesCmd() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }
    const folder = folders[0];
    await favoriteService.add({ name: folder.name, path: folder.uri.fsPath });
    refreshAll();
  }
}
