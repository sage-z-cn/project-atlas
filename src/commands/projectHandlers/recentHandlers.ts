import * as vscode from "vscode";
import type { MessageRouter } from "../../messages/messageRouter";
import { ProjectService } from "../../services/projectService";
import { FavoriteService } from "../../services/favoriteService";
import { GroupService } from "../../services/groupService";
import { openFolder, openInOS, resolveOpenMode } from "../../utils/opener";
import { getProjectTypeIcon } from "../../utils/projectTypeDetector";
import { confirmDelete } from "../../utils/confirm";
import { isPathValid } from "../../utils/validator";

/**
 * Recent 面板的 host 上下文。
 *
 * project router 由 recent + favorites（Phase 3）共享：二者订阅同一个
 * storage.onDidChange，故共享 router 让 broadcastEvent("projectDataChanged")
 * 同时到达两个 webview，各自 store 重拉自己的数据。
 */
export interface ProjectHandlerContext {
  messageRouter: MessageRouter;
  context: vscode.ExtensionContext;
  projectService: ProjectService;
  favoriteService: FavoriteService;
  groupService: GroupService;
}

/**
 * Recent 面板渲染单元（host 端构建，webview 端只渲染）。
 * icon/iconSource 沿用 projectTypeDetector 原始输出，由 webview ProjectIcon
 * 映射为 iconify `set:name`。DTO 形状与 legacy RecentViewProvider 一致，
 * 以保证行为保真。
 */
export interface RecentItemDto {
  id: string;
  name: string;
  path: string;
  isValid: boolean;
  timeLabel: string;
  icon: string;
  iconSource: "codicon" | "devicon";
}

/** project router 广播的事件名（webview 端需用相同字符串监听）。 */
export const PROJECT_EVENTS = {
  /** storage 数据变更 / 窗口聚焦 → webview 重拉 getRecentProjects / getFavoritesTree。 */
  dataChanged: "projectDataChanged",
  /** openMode 配置变更 → webview 仅更新本地 clickMode，无需重拉全量数据。 */
  openModeChanged: "openModeChanged",
} as const;

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return vscode.l10n.t("just now");
  if (minutes < 60) return vscode.l10n.t("{0} min ago", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return vscode.l10n.t("{0} hr ago", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 30) return vscode.l10n.t("{0} days ago", String(days));
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const CLICK_MODES = ["singleClick", "doubleClick", "followIDE"] as const;
type ClickMode = (typeof CLICK_MODES)[number];

/** 解析点击打开模式（projectAtlas.openMode，followIDE 回退 workbench.list.openMode）。 */
export function resolveClickMode(): "singleClick" | "doubleClick" {
  const config = vscode.workspace.getConfiguration("projectAtlas");
  let mode = config.get<string>("openMode", "followIDE") as ClickMode;
  if (mode === "followIDE") {
    const ideMode = vscode.workspace
      .getConfiguration("workbench.list")
      .get<string>("openMode", "singleClick");
    mode = ideMode === "doubleClick" ? "doubleClick" : "singleClick";
  }
  if (!CLICK_MODES.includes(mode as ClickMode)) {
    mode = "singleClick";
  }
  return mode as "singleClick" | "doubleClick";
}

/** 按 path 同时从 favorite + recent 移除（双列表同步）。 */
async function removeProjectFromBoth(
  favoriteService: FavoriteService,
  projectService: ProjectService,
  path: string,
): Promise<void> {
  const favProject = favoriteService.getByPath(path);
  if (favProject) {
    await favoriteService.remove(favProject.id);
  }
  const recentProject = projectService.getByPath(path);
  if (recentProject) {
    await projectService.removeProject(recentProject.id);
  }
}

/** 路径无效时弹窗，可选移除。返回是否已移除。 */
async function handleMissingProject(
  favoriteService: FavoriteService,
  projectService: ProjectService,
  project: { id: string; name: string; path: string },
): Promise<boolean> {
  const remove = vscode.l10n.t("Remove");
  const result = await vscode.window.showWarningMessage(
    vscode.l10n.t("Directory '{0}' does not exist.", project.name),
    { modal: true },
    remove,
  );
  if (result === remove) {
    await removeProjectFromBoth(favoriteService, projectService, project.path);
    return true;
  }
  return false;
}

/** 注册 Recent 面板的全部 MessageRouter handler。 */
export function registerRecentHandlers(ctx: ProjectHandlerContext): void {
  const { messageRouter, projectService, favoriteService, groupService } = ctx;

  messageRouter.handle("getRecentProjects", async () => {
    const limit = vscode.workspace
      .getConfiguration("projectAtlas")
      .get<number>("recentProjectsLimit", 50);
    return projectService.getRecent(limit).map(
      (p): RecentItemDto => {
        const iconInfo = getProjectTypeIcon(p.projectType);
        return {
          id: p.id,
          name: p.name,
          path: p.path,
          isValid: p.isValid,
          timeLabel: p.isValid
            ? formatRelativeTime(p.lastOpenedAt)
            : vscode.l10n.t("Invalid"),
          icon: iconInfo.icon,
          iconSource: iconInfo.iconSource,
        };
      },
    );
  });

  messageRouter.handle("getOpenMode", async () => {
    return { mode: resolveClickMode() };
  });

  messageRouter.handle("openProject", async (params) => {
    const id = params.id as string;
    const project = projectService.getById(id);
    if (!project) return;
    if (!isPathValid(project.path)) {
      await handleMissingProject(favoriteService, projectService, project);
      return;
    }
    const config = vscode.workspace.getConfiguration("projectAtlas");
    const mode = config.get<string>("openProjectMode", "ask");
    if (mode === "currentWindow") {
      await openFolder(vscode.Uri.file(project.path), false);
    } else if (mode === "newWindow") {
      await openFolder(vscode.Uri.file(project.path), true);
    } else {
      try {
        const newWindow = await resolveOpenMode();
        await openFolder(vscode.Uri.file(project.path), newWindow);
      } catch {
        /* cancelled */
      }
    }
  });

  messageRouter.handle("openInNewWindow", async (params) => {
    const project = projectService.getById(params.id as string);
    if (!project) return;
    if (!isPathValid(project.path)) {
      await handleMissingProject(favoriteService, projectService, project);
      return;
    }
    await openFolder(vscode.Uri.file(project.path), true);
  });

  messageRouter.handle("openInCurrentWindow", async (params) => {
    const project = projectService.getById(params.id as string);
    if (!project) return;
    if (!isPathValid(project.path)) {
      await handleMissingProject(favoriteService, projectService, project);
      return;
    }
    await openFolder(vscode.Uri.file(project.path), false);
  });

  messageRouter.handle("revealInExplorer", async (params) => {
    const project = projectService.getById(params.id as string);
    if (!project) return;
    openInOS(vscode.Uri.file(project.path));
  });

  messageRouter.handle("copyPath", async (params) => {
    const project = projectService.getById(params.id as string);
    if (!project) return;
    await vscode.env.clipboard.writeText(project.path);
  });

  messageRouter.handle("addFavorite", async (params) => {
    const project = projectService.getById(params.id as string);
    if (!project) return;
    const groupId = await groupService.pickGroup();
    if (groupId === null) return; // user cancelled
    await favoriteService.add({ name: project.name, path: project.path }, groupId);
  });

  messageRouter.handle("renameProject", async (params) => {
    const id = params.id as string;
    const project =
      projectService.getById(id) ?? favoriteService.getById(id);
    if (!project) return;
    const newName = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Rename project"),
      value: project.name,
    });
    if (newName) {
      await projectService.renameProject(id, newName);
      await favoriteService.rename(id, newName);
    }
  });

  messageRouter.handle("removeProject", async (params) => {
    const ids = (params.ids as string[] | undefined) ?? [];
    if (ids.length === 0) return;
    // 批量删除只确认一次（与 legacy contextAction 批量行为一致）。
    if (ids.length > 1) {
      const ok = await confirmDelete(
        vscode.l10n.t(
          "Are you sure you want to remove {0} selected items?",
          String(ids.length),
        ),
      );
      if (!ok) return;
    }
    for (const id of ids) {
      const project = projectService.getById(id);
      if (!project) continue;
      if (
        ids.length === 1 &&
        !(await confirmDelete(
          vscode.l10n.t("Are you sure you want to remove '{0}'?", project.name),
        ))
      ) {
        continue;
      }
      await removeProjectFromBoth(favoriteService, projectService, project.path);
    }
  });
}
