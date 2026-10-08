import { create } from "zustand";
import { bridge } from "../bridge";

/** 与 host TreeNodeDto 镜像。 */
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

/** host router 广播的事件名（与 src/commands/projectHandlers 一致）。 */
const EVENT_DATA_CHANGED = "projectDataChanged";
const EVENT_OPEN_MODE_CHANGED = "openModeChanged";
const EVENT_COLLAPSE_ALL = "favoritesCollapseAllRequested";
const EVENT_EXPAND_ALL = "favoritesExpandAllRequested";

/** Favorites 项目动作（host 命令名）。 */
export type FavoriteAction =
  | "openFavoriteInNewWindow"
  | "openFavoriteInCurrentWindow"
  | "revealFavoriteInExplorer"
  | "copyFavoritePath"
  | "renameFavorite"
  | "removeFavorite";

/**
 * webview 内弹窗状态（输入 / 确认，替代 host 原生 InputBox 与确认框）。
 * null = 无弹窗；文案在组件层按 kind 派生（store 只存纯数据）。
 */
export type FavoritesDialog =
  | { kind: "renameFavorite"; id: string; initialValue: string }
  | { kind: "addSubGroup"; id: string }
  | { kind: "renameGroup"; id: string; initialValue: string }
  | { kind: "removeFavorites"; ids: string[] }
  | { kind: "deleteGroups"; ids: string[] }
  | { kind: "deleteGroupStrategy"; id: string };

/** 深度查找树节点（弹窗初始值 / 消息里的名称用）。 */
export function findTreeNode(
  nodes: TreeNodeDto[],
  id: string,
): TreeNodeDto | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findTreeNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 读取删除确认偏好：confirmDelete === "never" 时调用方跳过弹窗直接执行。
 * 拉取失败保守起见返回 true（仍确认）。
 */
async function shouldConfirmDelete(): Promise<boolean> {
  try {
    const result = (await bridge.request("getConfirmPrefs")) as {
      confirmDelete?: string;
    };
    return result?.confirmDelete !== "never";
  } catch (err) {
    console.error("getConfirmPrefs failed:", err);
    return true;
  }
}

/** 持久化「不再询问」（勾选复选框确认时先落配置再执行动作）。 */
async function persistConfirmDeleteNever(): Promise<void> {
  try {
    await bridge.request("setConfirmDeleteNever");
  } catch (err) {
    console.error("setConfirmDeleteNever failed:", err);
  }
}

interface FavoritesStore {
  tree: TreeNodeDto[];
  clickMode: "singleClick" | "doubleClick";
  loading: boolean;
  selectedIds: Set<string>;
  focusedId: string | null;
  lastClickedId: string | null;
  expanded: Set<string>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  fetchOpenMode: () => Promise<void>;
  setClickMode: (m: "singleClick" | "doubleClick") => void;

  selectSingle: (id: string) => void;
  toggleSelect: (id: string) => void;
  rangeSelectTo: (id: string, visibleIds: string[]) => void;
  clearSelection: () => void;

  toggleExpand: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;

  open: (id: string) => Promise<void>;
  executeProjectAction: (action: FavoriteAction, ids: string[]) => Promise<void>;
  dropNode: (
    drag: { id: string; type: string },
    target: { id: string; type: string },
    position: string,
  ) => Promise<void>;

  // ── webview 内弹窗（输入 / 确认） ──
  dialog: FavoritesDialog | null;
  /** 重命名收藏：初始值取树节点名称。 */
  promptRenameFavorite: (id: string) => void;
  promptAddSubGroup: (id: string) => void;
  /** 重命名分组：初始值取树节点名称。 */
  promptRenameGroup: (id: string) => void;
  /** 移除收藏（单/批）：按确认偏好决定弹窗或直接执行。 */
  requestRemoveFavorites: (ids: string[]) => Promise<void>;
  /** 删除分组：单条非空 → 二选一弹窗；其余按确认偏好。 */
  requestDeleteGroups: (ids: string[]) => Promise<void>;
  /** 输入弹窗确认：按 kind 带 newName / name 发请求。 */
  resolveFavoritesInput: (name: string) => Promise<void>;
  /** 确认弹窗确认：dontAsk 时先落 setConfirmDeleteNever。 */
  confirmFavoritesDialog: (dontAsk: boolean) => Promise<void>;
  /** 非空组二选一：带 strategy + confirmed 执行。 */
  chooseDeleteGroupStrategy: (
    strategy: "moveToParent" | "removeAll",
  ) => Promise<void>;
  cancelFavoritesDialog: () => void;
  /** 移除收藏执行（confirmed 直发 + 清选择）。 */
  applyRemoveFavorites: (ids: string[]) => Promise<void>;
  /** 删除分组执行；strategy 仅单条非空组携带。 */
  applyDeleteGroups: (
    ids: string[],
    strategy?: "moveToParent" | "removeAll",
  ) => Promise<void>;
}

function collectGroupIds(nodes: TreeNodeDto[], acc: Set<string>): void {
  for (const n of nodes) {
    if (n.type === "group") {
      acc.add(n.id);
      if (n.children) collectGroupIds(n.children, acc);
    }
  }
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  tree: [],
  clickMode: "doubleClick",
  loading: true,
  selectedIds: new Set(),
  focusedId: null,
  lastClickedId: null,
  expanded: new Set(),
  dialog: null,

  init: async () => {
    // 恢复展开状态
    const persisted = bridge.getState() as { expanded?: string[] } | null;
    if (persisted?.expanded) set({ expanded: new Set(persisted.expanded) });
    await Promise.all([get().refresh(), get().fetchOpenMode()]);
  },
  refresh: async () => {
    try {
      const tree = (await bridge.request("getFavoritesTree")) as TreeNodeDto[];
      const present = new Set<string>();
      const walk = (nodes: TreeNodeDto[]): void => {
        for (const n of nodes) {
          present.add(n.id);
          if (n.children) walk(n.children);
        }
      };
      walk(tree);
      set({
        tree,
        loading: false,
        selectedIds: new Set([...get().selectedIds].filter((id) => present.has(id))),
        focusedId: get().focusedId && present.has(get().focusedId as string) ? get().focusedId : null,
        expanded: new Set([...get().expanded].filter((id) => present.has(id))),
      });
    } catch (err) {
      console.error("getFavoritesTree failed:", err);
      set({ loading: false });
    }
  },
  fetchOpenMode: async () => {
    try {
      const r = (await bridge.request("getOpenMode")) as { mode?: "singleClick" | "doubleClick" };
      if (r?.mode) set({ clickMode: r.mode });
    } catch (err) {
      console.error("getOpenMode failed:", err);
    }
  },
  setClickMode: (m) => set({ clickMode: m }),

  selectSingle: (id) => set({ selectedIds: new Set([id]), focusedId: id, lastClickedId: id }),
  toggleSelect: (id) => {
    const next = new Set(get().selectedIds);
    const was = next.has(id);
    if (was) next.delete(id);
    else next.add(id);
    set({ selectedIds: next, focusedId: was ? get().lastClickedId : id, lastClickedId: id });
  },
  rangeSelectTo: (id, visibleIds) => {
    const { lastClickedId } = get();
    if (!lastClickedId) {
      get().selectSingle(id);
      return;
    }
    const start = visibleIds.indexOf(lastClickedId);
    const end = visibleIds.indexOf(id);
    if (start === -1 || end === -1) {
      get().selectSingle(id);
      return;
    }
    const next = new Set(get().selectedIds);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let i = lo; i <= hi; i++) if (visibleIds[i]) next.add(visibleIds[i]);
    set({ selectedIds: next, focusedId: id });
  },
  clearSelection: () => set({ selectedIds: new Set(), focusedId: null, lastClickedId: null }),

  toggleExpand: (id) => {
    const next = new Set(get().expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ expanded: next });
    bridge.setState({ expanded: [...next] });
  },
  expandAll: () => {
    const next = new Set<string>();
    collectGroupIds(get().tree, next);
    set({ expanded: next });
    bridge.setState({ expanded: [...next] });
  },
  collapseAll: () => {
    set({ expanded: new Set() });
    bridge.setState({ expanded: [] });
  },

  open: async (id) => {
    try {
      await bridge.request("openFavorite", { id });
    } catch (err) {
      console.error("openFavorite failed:", err);
    }
  },
  executeProjectAction: async (action, ids) => {
    if (ids.length === 0) return;
    // 需要弹窗交互的动作在此分流；其余保持单 id 直发。
    if (action === "removeFavorite") {
      await get().requestRemoveFavorites(ids);
      return;
    }
    if (action === "renameFavorite") {
      get().promptRenameFavorite(ids[0]);
      return;
    }
    try {
      for (const id of ids) await bridge.request(action, { id });
    } catch (err) {
      console.error(`${action} failed:`, err);
    }
  },
  dropNode: async (drag, target, position) => {
    try {
      await bridge.request("dropNode", { drag, target, position });
    } catch (err) {
      console.error("dropNode failed:", err);
    }
  },

  // ── webview 内弹窗动作 ──
  promptRenameFavorite: (id) => {
    const node = findTreeNode(get().tree, id);
    set({ dialog: { kind: "renameFavorite", id, initialValue: node?.name ?? "" } });
  },

  promptAddSubGroup: (id) => {
    set({ dialog: { kind: "addSubGroup", id } });
  },

  promptRenameGroup: (id) => {
    const node = findTreeNode(get().tree, id);
    set({ dialog: { kind: "renameGroup", id, initialValue: node?.name ?? "" } });
  },

  requestRemoveFavorites: async (ids) => {
    if (ids.length === 0) return;
    if (await shouldConfirmDelete()) {
      set({ dialog: { kind: "removeFavorites", ids } });
      return;
    }
    await get().applyRemoveFavorites(ids);
  },

  requestDeleteGroups: async (ids) => {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      const node = findTreeNode(get().tree, ids[0]);
      if (node && (node.children?.length ?? 0) > 0) {
        // 非空组必须二选一（host 需要知道处理策略），不受"不再询问"影响。
        set({ dialog: { kind: "deleteGroupStrategy", id: ids[0] } });
        return;
      }
    }
    if (await shouldConfirmDelete()) {
      set({ dialog: { kind: "deleteGroups", ids } });
      return;
    }
    await get().applyDeleteGroups(ids);
  },

  resolveFavoritesInput: async (name) => {
    const dialog = get().dialog;
    if (
      !dialog ||
      dialog.kind === "removeFavorites" ||
      dialog.kind === "deleteGroups" ||
      dialog.kind === "deleteGroupStrategy"
    ) {
      return;
    }
    set({ dialog: null });
    try {
      if (dialog.kind === "renameFavorite") {
        await bridge.request("renameFavorite", { id: dialog.id, newName: name });
      } else if (dialog.kind === "renameGroup") {
        await bridge.request("renameGroup", { id: dialog.id, newName: name });
      } else {
        await bridge.request("addSubGroup", { id: dialog.id, name });
      }
    } catch (err) {
      console.error(`${dialog.kind} failed:`, err);
    }
  },

  confirmFavoritesDialog: async (dontAsk) => {
    const dialog = get().dialog;
    if (dialog?.kind === "removeFavorites") {
      set({ dialog: null });
      if (dontAsk) await persistConfirmDeleteNever();
      await get().applyRemoveFavorites(dialog.ids);
    } else if (dialog?.kind === "deleteGroups") {
      set({ dialog: null });
      if (dontAsk) await persistConfirmDeleteNever();
      await get().applyDeleteGroups(dialog.ids);
    }
  },

  chooseDeleteGroupStrategy: async (strategy) => {
    const dialog = get().dialog;
    if (dialog?.kind !== "deleteGroupStrategy") return;
    set({ dialog: null });
    await get().applyDeleteGroups([dialog.id], strategy);
  },

  cancelFavoritesDialog: () => set({ dialog: null }),

  /** 移除收藏执行（confirmed 直发 + 清选择）。 */
  applyRemoveFavorites: async (ids) => {
    try {
      await bridge.request("removeFavorite", { ids, confirmed: true });
    } catch (err) {
      console.error("removeFavorite failed:", err);
    }
    get().clearSelection();
  },

  /** 删除分组执行；strategy 仅单条非空组携带。 */
  applyDeleteGroups: async (ids, strategy) => {
    try {
      await bridge.request(
        "deleteGroup",
        strategy ? { ids, confirmed: true, strategy } : { ids, confirmed: true },
      );
    } catch (err) {
      console.error("deleteGroup failed:", err);
    }
    get().clearSelection();
  },
}));

// ── 事件订阅 ──
bridge.onEvent((event, data) => {
  if (event === EVENT_DATA_CHANGED) {
    void useFavoritesStore.getState().refresh();
  } else if (event === EVENT_OPEN_MODE_CHANGED) {
    const mode = (data as { mode?: "singleClick" | "doubleClick" } | null)?.mode;
    if (mode) useFavoritesStore.getState().setClickMode(mode);
  } else if (event === EVENT_COLLAPSE_ALL) {
    useFavoritesStore.getState().collapseAll();
  } else if (event === EVENT_EXPAND_ALL) {
    useFavoritesStore.getState().expandAll();
  }
});
