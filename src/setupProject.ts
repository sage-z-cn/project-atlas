import * as vscode from "vscode";
import { MessageRouter } from "./messages/messageRouter";
import { ReactViewProvider } from "./webview/reactViewProvider";
import { registerL10nBundleHandler } from "./messages/l10nHandler";
import {
  registerProjectHandlers,
  PROJECT_EVENTS,
  FAVORITES_EVENTS,
  resolveClickMode,
  type ProjectHandlerContext,
} from "./commands/projectHandlers";
import type { StorageService } from "./services/storageService";
import type { ProjectService } from "./services/projectService";
import type { FavoriteService } from "./services/favoriteService";
import type { GroupService } from "./services/groupService";

/**
 * Project Atlas（不含 Task）模块化装配入口。镜像 setupGit 的结构：
 * router + handlers + ReactViewProvider + 事件订阅集中一处，extension.ts
 * 的 activate() 只调用一次。
 *
 * Phase 1：注册 Recent 面板（React）。Favorites 仍为 legacy
 * FavoritesViewProvider（Phase 3 迁移），故本函数只接管 recent 视图与
 * projectDataChanged/openModeChanged 事件广播；favorites 的刷新仍由
 * extension.ts 的 refreshAll 驱动，直到 Phase 3。
 *
 * 事件契约（webview 端用相同字符串监听）：
 *   - projectDataChanged：storage 数据变更 / 窗口聚焦 → recent 重拉数据
 *   - openModeChanged：openMode 配置变更 → recent 仅更新本地 clickMode
 *
 * @returns 暴露 messageRouter 供后续 phase（Favorites）复用。
 */
export function setupProject(
  context: vscode.ExtensionContext,
  storage: StorageService,
  projectService: ProjectService,
  favoriteService: FavoriteService,
  groupService: GroupService,
): { messageRouter: MessageRouter } {
  // a. MessageRouter（recent + 后续 favorites 共享）
  const messageRouter = new MessageRouter();

  // b. i18n bridge handler（子系统无关）
  registerL10nBundleHandler(messageRouter, context);

  // c. 注册 Project handler
  const ctx: ProjectHandlerContext = {
    messageRouter,
    context,
    projectService,
    favoriteService,
    groupService,
  };
  registerProjectHandlers(ctx);

  // d. Recent 视图（React，mode="recent"）
  const recentProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "recent",
    "Project Atlas",
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "project-atlas.recent",
      recentProvider,
    ),
  );

  // d'. Favorites 视图（React，mode="favorites"）
  const favoritesProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "favorites",
    "Project Atlas",
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "project-atlas.favorites",
      favoritesProvider,
    ),
  );

  // view/title 命令：collapseAll/expandAll 改为事件驱动（原由 legacy
  // FavoritesViewProvider.collapseAll/expandAll 实现）
  context.subscriptions.push(
    vscode.commands.registerCommand("project-atlas.collapseAll", () => {
      messageRouter.broadcastEvent(FAVORITES_EVENTS.collapseAll, {});
    }),
    vscode.commands.registerCommand("project-atlas.expandAll", () => {
      messageRouter.broadcastEvent(FAVORITES_EVENTS.expandAll, {});
    }),
  );

  // e. 事件订阅
  //    storage 变更 → recent 重拉（favorites 仍由 extension.ts refreshAll 刷新）
  context.subscriptions.push(
    storage.onDidChange(() => {
      messageRouter.broadcastEvent(PROJECT_EVENTS.dataChanged, {});
    }),
  );

  //    openMode 配置变更 → recent 仅更新 clickMode（不重拉全量）
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("projectAtlas.openMode") ||
        e.affectsConfiguration("workbench.list.openMode")
      ) {
        messageRouter.broadcastEvent(PROJECT_EVENTS.openModeChanged, {
          mode: resolveClickMode(),
        });
      }
    }),
  );

  //    窗口聚焦 → recent 重拉（刷新相对时间标签，对齐 legacy 行为）
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        messageRouter.broadcastEvent(PROJECT_EVENTS.dataChanged, {});
      }
    }),
  );

  return { messageRouter };
}
