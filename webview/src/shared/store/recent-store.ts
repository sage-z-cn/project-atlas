import { create } from "zustand";
import { bridge } from "../bridge";

/** 与 host 端 RecentItemDto 镜像（host 构建 DTO，webview 只渲染）。 */
export interface RecentItemDto {
  id: string;
  name: string;
  path: string;
  isValid: boolean;
  timeLabel: string;
  icon: string;
  iconSource: "codicon" | "devicon";
}

/**
 * host router 广播的事件名（与 src/commands/projectHandlers/recentHandlers.ts
 * 的 PROJECT_EVENTS 一致）。
 */
const EVENT_DATA_CHANGED = "projectDataChanged";
const EVENT_OPEN_MODE_CHANGED = "openModeChanged";

/** Recent 面板的右键 / hover 动作名（与 host handler 注册的命令名对应）。 */
export type RecentAction =
  | "openInNewWindow"
  | "openInCurrentWindow"
  | "revealInExplorer"
  | "copyPath"
  | "addFavorite"
  | "renameProject"
  | "removeProject";

interface RecentStore {
  items: RecentItemDto[];
  clickMode: "singleClick" | "doubleClick";
  loading: boolean;
  selectedIds: Set<string>;
  focusedId: string | null;
  lastClickedId: string | null;

  // ── 生命周期 ──
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  fetchOpenMode: () => Promise<void>;
  setClickMode: (mode: "singleClick" | "doubleClick") => void;

  // ── 选择 ──
  selectSingle: (id: string) => void;
  toggleSelect: (id: string) => void;
  rangeSelectTo: (id: string) => void;
  /** 框选：直接替换为给定 id 集合（无修饰键）。 */
  setSelectionFromRect: (ids: string[]) => void;
  /** 框选 + Ctrl/Cmd：切换给定 id 的选中态。 */
  toggleSelectionFromRect: (ids: string[]) => void;
  /** 框选 + Shift：追加选中给定 id。 */
  addSelectionFromRect: (ids: string[]) => void;
  clearSelection: () => void;

  // ── 动作 ──
  open: (id: string) => Promise<void>;
  executeAction: (action: RecentAction, ids: string[]) => Promise<void>;
}

export const useRecentStore = create<RecentStore>((set, get) => ({
  items: [],
  clickMode: "doubleClick",
  loading: true,
  selectedIds: new Set(),
  focusedId: null,
  lastClickedId: null,

  init: async () => {
    await Promise.all([get().refresh(), get().fetchOpenMode()]);
  },

  refresh: async () => {
    try {
      const items = (await bridge.request("getRecentProjects")) as RecentItemDto[];
      // 重拉后将选择收敛到仍存在的项（被删除的项自动移出选择集）。
      const present = new Set(items.map((i) => i.id));
      const selectedIds = new Set(
        [...get().selectedIds].filter((id) => present.has(id)),
      );
      const prevFocused = get().focusedId;
      set({
        items,
        loading: false,
        selectedIds,
        focusedId: prevFocused && present.has(prevFocused) ? prevFocused : null,
      });
    } catch (err) {
      console.error("getRecentProjects failed:", err);
      set({ loading: false });
    }
  },

  fetchOpenMode: async () => {
    try {
      const result = (await bridge.request("getOpenMode")) as {
        mode?: "singleClick" | "doubleClick";
      };
      if (result?.mode) set({ clickMode: result.mode });
    } catch (err) {
      console.error("getOpenMode failed:", err);
    }
  },

  setClickMode: (mode) => set({ clickMode: mode }),

  selectSingle: (id) =>
    set({ selectedIds: new Set([id]), focusedId: id, lastClickedId: id }),

  toggleSelect: (id) => {
    const next = new Set(get().selectedIds);
    const wasSelected = next.has(id);
    if (wasSelected) next.delete(id);
    else next.add(id);
    // 对齐 legacy：toggle off 时焦点回退到上一个 anchor，而非停留在被取消的 id。
    set({
      selectedIds: next,
      focusedId: wasSelected ? get().lastClickedId : id,
      lastClickedId: id,
    });
  },

  rangeSelectTo: (id) => {
    const { items, lastClickedId } = get();
    if (!lastClickedId) {
      get().selectSingle(id);
      return;
    }
    const allIds = items.map((i) => i.id);
    const start = allIds.indexOf(lastClickedId);
    const end = allIds.indexOf(id);
    if (start === -1 || end === -1) {
      get().selectSingle(id);
      return;
    }
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const next = new Set(get().selectedIds);
    for (let i = lo; i <= hi; i++) next.add(allIds[i]);
    set({ selectedIds: next, focusedId: id });
  },

  setSelectionFromRect: (ids) => {
    const next = new Set(ids);
    const last = ids.length ? ids[ids.length - 1] : null;
    set({ selectedIds: next, focusedId: last, lastClickedId: last });
  },

  toggleSelectionFromRect: (ids) => {
    const next = new Set(get().selectedIds);
    for (const id of ids) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    const last = ids.length ? ids[ids.length - 1] : null;
    set({ selectedIds: next, lastClickedId: last });
  },

  addSelectionFromRect: (ids) => {
    const next = new Set(get().selectedIds);
    for (const id of ids) next.add(id);
    const last = ids.length ? ids[ids.length - 1] : get().lastClickedId;
    set({ selectedIds: next, lastClickedId: last });
  },

  clearSelection: () =>
    set({ selectedIds: new Set(), focusedId: null, lastClickedId: null }),

  open: async (id) => {
    try {
      await bridge.request("openProject", { id });
    } catch (err) {
      console.error("openProject failed:", err);
    }
  },

  executeAction: async (action, ids) => {
    if (ids.length === 0) return;
    try {
      switch (action) {
        case "openInNewWindow":
        case "openInCurrentWindow":
        case "revealInExplorer":
        case "copyPath":
        case "addFavorite":
        case "renameProject":
          // 这些命令 host 端按单 id 处理；逐个发送（与 legacy contextAction 循环一致）。
          for (const id of ids) {
            await bridge.request(action, { id });
          }
          break;
        case "removeProject":
          // 批量：host 端统一确认一次。
          await bridge.request("removeProject", { ids });
          break;
      }
      // 删除类动作后清理选择（host 的 projectDataChanged 也会触发 refresh，
      // 但显式清选择让 UI 即时响应）。
      if (action === "removeProject") {
        get().clearSelection();
      }
    } catch (err) {
      console.error(`${action} failed:`, err);
    }
  },
}));

// ── 事件订阅（模块级，import 时注册，对齐 commit-store 模式）──
bridge.onEvent((event, data) => {
  if (event === EVENT_DATA_CHANGED) {
    void useRecentStore.getState().refresh();
  } else if (event === EVENT_OPEN_MODE_CHANGED) {
    const mode = (data as { mode?: "singleClick" | "doubleClick" } | null)?.mode;
    if (mode) useRecentStore.getState().setClickMode(mode);
  }
});
