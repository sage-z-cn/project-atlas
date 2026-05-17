import * as vscode from "vscode";
import { GroupService } from "../services/groupService";
import { ProjectService } from "../services/projectService";
import type { GroupItem } from "../models/group";

type GroupNode = { type: "group"; item: GroupItem };

export function registerGroupCommands(
  context: vscode.ExtensionContext,
  groupService: GroupService,
  projectService: ProjectService,
  refreshAll: () => void
): void {
  const register = (cmd: string, handler: (...args: any[]) => any) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(`project-explorer.${cmd}`, handler)
    );
  };

  register("addGroup", addGroupCmd);
  register("renameGroup", renameGroupCmd);
  register("deleteGroup", deleteGroupCmd);
  register("toggleCollapse", toggleCollapseCmd);
  register("cleanInvalid", cleanInvalidCmd);
  register("openSettings", openSettingsCmd);

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

    const projects = projectService.getByGroup(node.item.id);
    const children = groupService.getChildren(node.item.id);

    if (projects.length > 0 || children.length > 0) {
      const action = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Group '{0}' contains items. What would you like to do?",
          node.item.name
        ),
        { modal: true },
        vscode.l10n.t("Move to parent"),
        vscode.l10n.t("Delete all")
      );
      if (!action) {return;}
      await groupService.deleteGroup(node.item.id, action === vscode.l10n.t("Move to parent"));
    } else {
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t("Delete group '{0}'?", node.item.name),
        { modal: true },
        vscode.l10n.t("Delete")
      );
      if (confirm !== vscode.l10n.t("Delete")) {return;}
      await groupService.deleteGroup(node.item.id, true);
    }

    refreshAll();
  }

  function toggleCollapseCmd() {
    vscode.commands.executeCommand(
      "workbench.actions.treeView.project-explorer.projects.collapseAll"
    );
  }

  async function cleanInvalidCmd() {
    const invalid = projectService.getAll().filter((p) => !p.isValid);
    if (invalid.length === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("No invalid projects found.")
      );
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Found {0} invalid project(s). Remove them all?",
        String(invalid.length)
      ),
      { modal: true },
      vscode.l10n.t("Remove All")
    );

    if (confirm !== vscode.l10n.t("Remove All")) {return;}

    const removed = await projectService.cleanInvalid();
    vscode.window.showInformationMessage(
      vscode.l10n.t("Removed {0} invalid project(s).", String(removed))
    );
    refreshAll();
  }

  function openSettingsCmd() {
    vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "projectExplorer"
    );
  }
}
