import * as vscode from "vscode";
import type { ProjectItem } from "../models/project";
import type { GroupItem } from "../models/group";
import { ProjectService } from "../services/projectService";
import { GroupService } from "../services/groupService";

type TreeNode =
  | { type: "group"; item: GroupItem }
  | { type: "project"; item: ProjectItem };

export class ProjectTreeProvider
  implements
    vscode.TreeDataProvider<TreeNode>,
    vscode.TreeDragAndDropController<TreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  dropMimeTypes = ["application/vnd.code.tree.project-explorer"];
  dragMimeTypes = ["application/vnd.code.tree.project-explorer"];

  constructor(
    private projectService: ProjectService,
    private groupService: GroupService
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === "group") {
      const g = element.item;
      const hasChildren =
        this.groupService.getChildren(g.id).length > 0 ||
        this.projectService.getByGroup(g.id).length > 0;
      const item = new vscode.TreeItem(
        g.name,
        hasChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      );
      item.id = g.id;
      item.iconPath = new vscode.ThemeIcon("symbol-folder");
      item.contextValue = "group";
      item.resourceUri = vscode.Uri.parse(`project-explorer://group/${g.id}`);
      return item;
    }

    const p = element.item;
    const treeItem = new vscode.TreeItem(p.name);
    treeItem.id = p.id;
    treeItem.description = p.path;
    treeItem.iconPath = new vscode.ThemeIcon("folder");
    let ctx = p.isFavorite ? "project-fav" : "project";
    if (!p.isValid) { ctx += "-invalid"; }
    treeItem.contextValue = ctx;
    treeItem.resourceUri = vscode.Uri.file(p.path);
    treeItem.command = {
      command: "project-explorer.openProjectBySetting",
      title: vscode.l10n.t("Open"),
      arguments: [element],
    };

    if (!p.isValid) {
      treeItem.description = `${p.path} (${vscode.l10n.t("Invalid")})`;
      treeItem.iconPath = new vscode.ThemeIcon(
        "folder",
        new vscode.ThemeColor("disabledForeground")
      );
    }

    return treeItem;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.getRootChildren();
    }

    if (element.type === "group") {
      const children: TreeNode[] = [];
      children.push(
        ...this.groupService
          .getChildren(element.item.id)
          .map((g) => ({ type: "group" as const, item: g }))
      );
      children.push(
        ...this.projectService
          .getByGroup(element.item.id)
          .map((p) => ({ type: "project" as const, item: p }))
      );
      return children;
    }

    return [];
  }

  private getRootChildren(): TreeNode[] {
    const result: TreeNode[] = [];

    result.push(
      ...this.groupService
        .getRootGroups()
        .map((g) => ({ type: "group" as const, item: g }))
    );

    result.push(
      ...this.projectService
        .getUngrouped()
        .map((p) => ({ type: "project" as const, item: p }))
    );

    return result;
  }

  handleDrag(
    source: TreeNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    if (source.length === 0) {return;}

    dataTransfer.set(
      "application/vnd.code.tree.project-explorer",
      new vscode.DataTransferItem(
        source.map((n) => ({
          type: n.type,
          id: n.item.id,
        }))
      )
    );
  }

  async handleDrop(
    target: TreeNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const payload = dataTransfer.get(
      "application/vnd.code.tree.project-explorer"
    );
    if (!payload?.value) {return;}

    const items = payload.value as Array<{
      type: string;
      id: string;
    }>;

    for (const item of items) {
      if (item.type === "project") {
        await this.dropProject(item.id, target);
      } else if (item.type === "group") {
        await this.dropGroup(item.id, target);
      }
    }

    this.refresh();
  }

  private async dropProject(
    projectId: string,
    target: TreeNode | undefined
  ): Promise<void> {
    let targetGroupId: string | undefined;

    if (target?.type === "group") {
      targetGroupId = target.item.id;
    } else if (target?.type === "project" && target.item.groupId) {
      targetGroupId = target.item.groupId;
    }

    await this.projectService.moveToGroup(projectId, targetGroupId);
  }

  private async dropGroup(
    groupId: string,
    target: TreeNode | undefined
  ): Promise<void> {
    if (target?.type === "group") {
      if (this.groupService.isDescendant(target.item.id, groupId)) {return;}
      await this.groupService.updateParent(groupId, target.item.id);
    } else {
      await this.groupService.updateParent(groupId, undefined);
    }
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element.type === "project" && element.item.groupId) {
      const group = this.groupService.getById(element.item.groupId);
      if (group) {return { type: "group", item: group };}
    }
    return undefined;
  }
}
