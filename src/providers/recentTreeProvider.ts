import * as vscode from "vscode";
import type { ProjectItem } from "../models/project";
import { ProjectService } from "../services/projectService";

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {return vscode.l10n.t("just now");}
  if (minutes < 60) {return vscode.l10n.t("{0} min ago", String(minutes));}
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {return vscode.l10n.t("{0} hr ago", String(hours));}
  const days = Math.floor(hours / 24);
  if (days < 30) {return vscode.l10n.t("{0} days ago", String(days));}
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type TreeNode = { type: "project"; item: ProjectItem };

export class RecentTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private projectService: ProjectService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const p = element.item;
    const treeItem = new vscode.TreeItem(p.name);
    treeItem.id = p.id;
    treeItem.description = formatRelativeTime(p.lastOpenedAt);
    treeItem.iconPath = new vscode.ThemeIcon("clock");
    treeItem.contextValue = p.isValid ? "recent-project" : "recent-project-invalid";
    treeItem.resourceUri = vscode.Uri.file(p.path);
    treeItem.command = {
      command: "project-atlas.openProjectBySetting",
      title: vscode.l10n.t("Open"),
      arguments: [element],
    };

    if (!p.isValid) {
      treeItem.description = vscode.l10n.t("Invalid");
      treeItem.iconPath = new vscode.ThemeIcon(
        "clock",
        new vscode.ThemeColor("disabledForeground")
      );
    }

    return treeItem;
  }

  getChildren(): TreeNode[] {
    const config = vscode.workspace.getConfiguration("projectAtlas");
    const limit = config.get<number>("recentProjectsLimit", 50);
    return this.projectService
      .getRecent(limit)
      .map((p) => ({ type: "project" as const, item: p }));
  }
}
