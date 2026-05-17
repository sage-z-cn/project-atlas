import * as vscode from "vscode";
import type { ProjectItem } from "../models/project";
import { ProjectService } from "../services/projectService";

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
    treeItem.description = p.path;
    treeItem.iconPath = new vscode.ThemeIcon("clock");
    treeItem.contextValue = p.isValid ? "recent-project" : "recent-project-invalid";
    treeItem.resourceUri = vscode.Uri.file(p.path);
    treeItem.command = {
      command: "project-explorer.openProjectBySetting",
      title: vscode.l10n.t("Open"),
      arguments: [element],
    };

    if (!p.isValid) {
      treeItem.description = `${p.path} (${vscode.l10n.t("Invalid")})`;
      treeItem.iconPath = new vscode.ThemeIcon(
        "clock",
        new vscode.ThemeColor("disabledForeground")
      );
    }

    return treeItem;
  }

  getChildren(): TreeNode[] {
    const config = vscode.workspace.getConfiguration("projectExplorer");
    const limit = config.get<number>("recentProjectsLimit", 20);
    return this.projectService
      .getRecent(limit)
      .map((p) => ({ type: "project" as const, item: p }));
  }
}
