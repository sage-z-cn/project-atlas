import * as vscode from "vscode";
import type { MessageRouter } from "../../messages/messageRouter";
import { ProjectService } from "../../services/projectService";
import { FavoriteService } from "../../services/favoriteService";
import { GroupService } from "../../services/groupService";
import { openFolder, openInOS, resolveOpenMode } from "../../utils/opener";
import { getProjectTypeIcon } from "../../utils/projectTypeDetector";
import { confirmDelete } from "../../utils/confirm";
import { isPathValid } from "../../utils/validator";
import type { ProjectHandlerContext } from "./recentHandlers";

/** Favorites 树节点 DTO（host 端构建，webview 只渲染）。 */
export interface TreeNodeDto {
  id: string;
  type: "group" | "project";
  name: string;
  path?: string;
  isValid?: boolean;
  icon?: string;
  iconSource?: "codicon" | "devicon";
  children?: TreeNodeDto[];
}

/** view/title 命令 + 事件名（collapseAll/expandAll 改事件驱动）。 */
export const FAVORITES_EVENTS = {
  collapseAll: "favoritesCollapseAllRequested",
  expandAll: "favoritesExpandAllRequested",
} as const;

/** 注册 Favorites 面板的全部 MessageRouter handler（与 Recent 共享 project router）。 */
export function registerFavoritesHandlers(ctx: ProjectHandlerContext): void {
  const { messageRouter, projectService, favoriteService, groupService } = ctx;

  messageRouter.handle("getFavoritesTree", async (): Promise<TreeNodeDto[]> => {
    return buildTree(groupService, favoriteService);
  });

  messageRouter.handle("dropNode", async (params) => {
    const drag = params.drag as { id: string; type: string };
    const target = params.target as { id: string; type: string };
    const position = params.position as string;
    if (!drag || !target || !position) return;
    if (drag.id === target.id) return;
    if (drag.type === "project") {
      await dropProject(favoriteService, groupService, drag.id, target, position);
    } else if (drag.type === "group") {
      await dropGroup(groupService, drag.id, target, position);
    }
  });

  // ── 项目动作 ──
  messageRouter.handle("openFavorite", async (params) => {
    const project = favoriteService.getById(params.id as string);
    if (!project) return;
    await openProjectByPath(projectService, favoriteService, project.path, project.name);
  });
  messageRouter.handle("openFavoriteInNewWindow", async (params) => {
    const project = favoriteService.getById(params.id as string);
    if (!project) return;
    if (!isPathValid(project.path)) return;
    await openFolder(vscode.Uri.file(project.path), true);
  });
  messageRouter.handle("openFavoriteInCurrentWindow", async (params) => {
    const project = favoriteService.getById(params.id as string);
    if (!project) return;
    if (!isPathValid(project.path)) return;
    await openFolder(vscode.Uri.file(project.path), false);
  });
  messageRouter.handle("revealFavoriteInExplorer", async (params) => {
    const project = favoriteService.getById(params.id as string);
    if (!project) return;
    openInOS(vscode.Uri.file(project.path));
  });
  messageRouter.handle("copyFavoritePath", async (params) => {
    const project = favoriteService.getById(params.id as string);
    if (!project) return;
    await vscode.env.clipboard.writeText(project.path);
  });
  messageRouter.handle("renameFavorite", async (params) => {
    const id = params.id as string;
    const fav = favoriteService.getById(id);
    const recent = projectService.getById(id);
    const current = fav ?? recent;
    if (!current) return;
    const newName = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Rename project"),
      value: current.name,
    });
    if (newName) {
      await projectService.renameProject(id, newName);
      await favoriteService.rename(id, newName);
    }
  });
  messageRouter.handle("removeFavorite", async (params) => {
    const ids = (params.ids as string[] | undefined) ?? [];
    if (ids.length === 0) return;
    if (ids.length > 1) {
      const ok = await confirmDelete(
        vscode.l10n.t("Are you sure you want to remove {0} selected items?", String(ids.length)),
      );
      if (!ok) return;
    }
    for (const id of ids) {
      const project = favoriteService.getById(id);
      if (!project) continue;
      if (ids.length === 1) {
        const ok = await confirmDelete(
          vscode.l10n.t("Are you sure you want to remove '{0}' from favorites?", project.name),
        );
        if (!ok) continue;
      }
      await favoriteService.remove(id);
    }
  });

  // ── 分组动作 ──
  messageRouter.handle("addSubGroup", async (params) => {
    const parentId = params.id as string;
    const name = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Enter sub-group name"),
    });
    if (name) await groupService.addGroup(name, parentId);
  });
  messageRouter.handle("renameGroup", async (params) => {
    const id = params.id as string;
    const group = groupService.getById(id);
    if (!group) return;
    const newName = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Rename group"),
      value: group.name,
    });
    if (newName) await groupService.renameGroup(id, newName);
  });
  messageRouter.handle("deleteGroup", async (params) => {
    const ids = (params.ids as string[] | undefined) ?? [];
    if (ids.length === 0) return;
    if (ids.length > 1) {
      const ok = await confirmDelete(
        vscode.l10n.t("Are you sure you want to remove {0} selected items?", String(ids.length)),
      );
      if (!ok) return;
    }
    for (const id of ids) {
      const group = groupService.getById(id);
      if (!group) continue;
      const projects = favoriteService.getByGroup(id);
      const children = groupService.getChildren(id);
      if (projects.length > 0 || children.length > 0) {
        if (ids.length > 1) {
          // 批量：已统一确认，自动移除
          await groupService.deleteGroup(id, false);
        } else {
          const act = await vscode.window.showWarningMessage(
            vscode.l10n.t("Group '{0}' contains items. What would you like to do?", group.name),
            { modal: true },
            vscode.l10n.t("Move to parent"),
            vscode.l10n.t("Remove all from favorites"),
          );
          if (!act) continue;
          await groupService.deleteGroup(id, act === vscode.l10n.t("Move to parent"));
        }
      } else {
        if (ids.length === 1) {
          const ok = await confirmDelete(
            vscode.l10n.t("Are you sure you want to delete group '{0}'?", group.name),
          );
          if (!ok) continue;
        }
        await groupService.deleteGroup(id, true);
      }
    }
  });
}

// ── buildTree（逐行移植 favoritesViewProvider.buildTree）──
function buildTree(
  groupService: GroupService,
  favoriteService: FavoriteService,
): TreeNodeDto[] {
  const result: TreeNodeDto[] = [];
  const addGroup = (groupId: string): TreeNodeDto => {
    const g = groupService.getById(groupId)!;
    const children: TreeNodeDto[] = [];
    for (const child of groupService.getChildren(groupId)) {
      children.push(addGroup(child.id));
    }
    for (const p of favoriteService.getByGroup(groupId)) {
      const iconInfo = getProjectTypeIcon(p.projectType);
      children.push({
        id: p.id,
        type: "project",
        name: p.name,
        path: p.path,
        isValid: p.isValid,
        icon: iconInfo.icon,
        iconSource: iconInfo.iconSource,
      });
    }
    return { id: g.id, type: "group", name: g.name, children };
  };
  for (const g of groupService.getRootGroups()) {
    result.push(addGroup(g.id));
  }
  for (const p of favoriteService.getUngrouped()) {
    const iconInfo = getProjectTypeIcon(p.projectType);
    result.push({
      id: p.id,
      type: "project",
      name: p.name,
      path: p.path,
      isValid: p.isValid,
      icon: iconInfo.icon,
      iconSource: iconInfo.iconSource,
    });
  }
  return result;
}

/** 按 openProjectMode 配置打开项目（ask/currentWindow/newWindow）。 */
async function openProjectByPath(
  projectService: ProjectService,
  _favoriteService: FavoriteService,
  projectPath: string,
  projectName: string,
): Promise<void> {
  void projectService;
  void _favoriteService;
  if (!isPathValid(projectPath)) {
    // 无效目录提示（简化：直接提示，不提供移除——Favorites 的移除走 removeFavorite）
    await vscode.window.showWarningMessage(
      vscode.l10n.t("Directory '{0}' does not exist.", projectName),
      { modal: true },
    );
    return;
  }
  const config = vscode.workspace.getConfiguration("projectAtlas");
  const mode = config.get<string>("openProjectMode", "ask");
  if (mode === "currentWindow") {
    await openFolder(vscode.Uri.file(projectPath), false);
  } else if (mode === "newWindow") {
    await openFolder(vscode.Uri.file(projectPath), true);
  } else {
    try {
      const newWindow = await resolveOpenMode();
      await openFolder(vscode.Uri.file(projectPath), newWindow);
    } catch {
      /* cancelled */
    }
  }
}

// ── dropProject / dropGroup（逐行移植 favoritesViewProvider，业务逻辑零改动）──
async function dropProject(
  favoriteService: FavoriteService,
  groupService: GroupService,
  projectId: string,
  target: { id: string; type: string },
  position: string,
): Promise<void> {
  if (position === "inside" && target.type === "group") {
    await favoriteService.moveToGroup(projectId, target.id);
  } else if (target.type === "project") {
    if (position === "before") {
      await favoriteService.reorderAfter(projectId, target.id);
    } else if (position === "after") {
      const targetProject = favoriteService.getById(target.id);
      if (targetProject) {
        const siblings = targetProject.groupId
          ? favoriteService.getByGroup(targetProject.groupId)
          : favoriteService.getUngrouped();
        const idx = siblings.findIndex((p) => p.id === target.id);
        if (idx >= 0 && idx < siblings.length - 1) {
          await favoriteService.reorderAfter(projectId, siblings[idx + 1].id);
        } else {
          await favoriteService.moveToGroup(projectId, targetProject.groupId);
        }
      }
    }
  } else if (target.type === "group") {
    if (position === "before" || position === "after") {
      const targetGroup = groupService.getById(target.id);
      if (targetGroup) {
        await favoriteService.moveToGroup(projectId, targetGroup.parentId || undefined);
      }
    }
  }
}

async function dropGroup(
  groupService: GroupService,
  groupId: string,
  target: { id: string; type: string },
  position: string,
): Promise<void> {
  if (position === "inside" && target.type === "group") {
    if (groupService.isDescendant(target.id, groupId)) return;
    await groupService.updateParent(groupId, target.id);
  } else if (position === "before" || position === "after") {
    if (target.type === "group") {
      const targetGroup = groupService.getById(target.id);
      if (!targetGroup) return;
      if (groupService.isDescendant(target.id, groupId)) return;
      const dragged = groupService.getById(groupId);
      if (dragged && dragged.parentId === targetGroup.parentId) {
        if (position === "before") {
          await groupService.reorderAfter(groupId, target.id);
        } else {
          const siblings = targetGroup.parentId
            ? groupService.getChildren(targetGroup.parentId)
            : groupService.getRootGroups();
          const idx = siblings.findIndex((g) => g.id === target.id);
          if (idx >= 0 && idx < siblings.length - 1) {
            await groupService.reorderAfter(groupId, siblings[idx + 1].id);
          } else {
            await groupService.updateParent(groupId, targetGroup.parentId || undefined);
            const orderSiblings = targetGroup.parentId
              ? groupService.getChildren(targetGroup.parentId)
              : groupService.getRootGroups();
            const maxOrder = orderSiblings
              .filter((g) => g.id !== groupId)
              .reduce((max, g) => Math.max(max, g.order), -1);
            await groupService.updateOrder(groupId, maxOrder + 1);
          }
        }
      } else {
        await groupService.updateParent(groupId, targetGroup.parentId || undefined);
      }
    } else {
      // 拖到根级 project 附近 → 移到根
      await groupService.updateParent(groupId, undefined);
      const rootGroups = groupService.getRootGroups().filter((g) => g.id !== groupId);
      const maxOrder = rootGroups.reduce((max, g) => Math.max(max, g.order), -1);
      await groupService.updateOrder(groupId, maxOrder + 1);
    }
  }
}
