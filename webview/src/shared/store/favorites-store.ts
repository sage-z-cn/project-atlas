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
    try {
      if (action === "removeFavorite") {
        await bridge.request("removeFavorite", { ids });
        get().clearSelection();
      } else {
        for (const id of ids) await bridge.request(action, { id });
      }
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
