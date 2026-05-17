import * as vscode from "vscode";
import type { ProjectItem } from "../models/project";
import { ProjectService } from "../services/projectService";

export class FavoriteTreeProvider implements vscode.TreeDataProvider<ProjectItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ProjectItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private projectService: ProjectService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProjectItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name);
    item.id = element.id;
    item.description = element.path;
    item.iconPath = new vscode.ThemeIcon("star-full");
    item.contextValue = element.isValid ? "favorite-project" : "favorite-project-invalid";
    item.resourceUri = vscode.Uri.file(element.path);
    item.command = {
      command: "project-explorer.openProjectBySetting",
      title: vscode.l10n.t("Open"),
      arguments: [{ type: "project", item: element }],
    };

    if (!element.isValid) {
      item.description = `${element.path} (${vscode.l10n.t("Invalid")})`;
      item.iconPath = new vscode.ThemeIcon(
        "star-full",
        new vscode.ThemeColor("disabledForeground")
      );
    }

    return item;
  }

  getChildren(): ProjectItem[] {
    return this.projectService.getFavorites();
  }
}
