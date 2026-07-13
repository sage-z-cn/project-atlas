import type { ProjectHandlerContext } from "./recentHandlers";
import { registerRecentHandlers } from "./recentHandlers";
import { registerFavoritesHandlers } from "./favoritesHandlers";

/**
 * Project 子系统 MessageRouter handler 聚合入口。Recent + Favorites 共享同一
 * router + ProjectHandlerContext（二者订阅同一 storage.onDidChange）。
 */
export function registerProjectHandlers(ctx: ProjectHandlerContext): void {
  registerRecentHandlers(ctx);
  registerFavoritesHandlers(ctx);
}

export type { ProjectHandlerContext, RecentItemDto } from "./recentHandlers";
export { PROJECT_EVENTS, resolveClickMode } from "./recentHandlers";
export type { TreeNodeDto } from "./favoritesHandlers";
export { FAVORITES_EVENTS } from "./favoritesHandlers";
