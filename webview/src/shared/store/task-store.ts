import { create } from "zustand";
import { bridge } from "../bridge";

/** 与 host TaskItemDto/TaskProjectDto 镜像。 */
export interface TaskItemDto {
  id: string;
  name: string;
  source: "vscode" | "npm";
  isRunning: boolean;
  relativeDir: string;
  cwd: string;
  packageManager: string;
}
export interface TaskProjectDto {
  relativePath: string;
  tasks: TaskItemDto[];
}

/** host router 广播的事件名（与 src/commands/taskHandlers/taskHandlers.ts TASK_EVENTS 一致）。 */
const EVENT_CHANGED = "tasksChanged";
const EVENT_EXPAND_ALL = "expandAllRequested";
const EVENT_COLLAPSE_ALL = "collapseAllRequested";

interface PersistedExpand {
  expandedProjects?: string[];
  expandedPinned?: boolean;
  expandedRecent?: boolean;
}

interface TaskStore {
  pinnedItems: TaskItemDto[];
  recentItems: TaskItemDto[];
  rootProject: TaskProjectDto;
  projects: TaskProjectDto[];
  /** 根任务段标签（工作区名）。 */
  workspaceName: string;
  loading: boolean;
  /** 乐观运行态：点 run 后立即加入，refresh（tasksChanged）后清空（host isRunning 接管）。 */
  optimisticRunningIds: Set<string>;
  expandedProjects: Set<string>;
  expandedPinned: boolean;
  expandedRecent: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  saveExpand: () => void;

  toggleProject: (path: string) => void;
  togglePinned: () => void;
  toggleRecent: () => void;
  expandAll: () => void;
  collapseAll: () => void;

  run: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  pin: (id: string) => Promise<void>;
  unpin: (id: string) => Promise<void>;
  removeRecent: (id: string) => Promise<void>;
  reorder: (dragId: string, targetId: string, position: string) => Promise<void>;

  /** 任务是否处于运行态（含乐观）。 */
  isRunning: (id: string) => boolean;
}

const EMPTY_ROOT: TaskProjectDto = { relativePath: "", tasks: [] };

export const useTaskStore = create<TaskStore>((set, get) => ({
  pinnedItems: [],
  recentItems: [],
  rootProject: EMPTY_ROOT,
  projects: [],
  workspaceName: "Root",
  loading: true,
  optimisticRunningIds: new Set(),
  expandedProjects: new Set(),
  expandedPinned: true,
  expandedRecent: true,

  init: async () => {
    // 从 webview 持久态恢复展开状态（vscode.getState）
    const persisted = bridge.getState() as PersistedExpand | null;
    const firstLoad = !persisted || persisted.expandedProjects === undefined;
    if (persisted && persisted.expandedProjects) {
      set({
        expandedProjects: new Set(persisted.expandedProjects),
        expandedPinned: persisted.expandedPinned ?? true,
        expandedRecent: persisted.expandedRecent ?? true,
      });
    }
    await get().refresh();
    // 首次加载自动展开全部项目（与 legacy firstLoad 行为一致）
    if (firstLoad) {
      const { rootProject, projects } = get();
      const next = new Set(get().expandedProjects);
      if (rootProject.tasks.length > 0 && projects.length > 0) {
        next.add(rootProject.relativePath);
      }
      for (const p of projects) next.add(p.relativePath);
      set({ expandedProjects: next });
      get().saveExpand();
    }
  },

  refresh: async () => {
    try {
      const data = (await bridge.request("getTasks")) as {
        pinnedItems: TaskItemDto[];
        recentItems: TaskItemDto[];
        rootProject: TaskProjectDto;
        projects: TaskProjectDto[];
        workspaceName?: string;
      };
      set({
        pinnedItems: data.pinnedItems ?? [],
        recentItems: data.recentItems ?? [],
        rootProject: data.rootProject ?? EMPTY_ROOT,
        projects: data.projects ?? [],
        workspaceName: data.workspaceName ?? "Root",
        loading: false,
        optimisticRunningIds: new Set(),
      });
    } catch (err) {
      console.error("getTasks failed:", err);
      set({ loading: false, optimisticRunningIds: new Set() });
    }
  },

  saveExpand: () => {
    const { expandedProjects, expandedPinned, expandedRecent } = get();
    bridge.setState({
      expandedProjects: [...expandedProjects],
      expandedPinned,
      expandedRecent,
    });
  },

  toggleProject: (path) => {
    const next = new Set(get().expandedProjects);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    set({ expandedProjects: next });
    get().saveExpand();
  },
  togglePinned: () => {
    set({ expandedPinned: !get().expandedPinned });
    get().saveExpand();
  },
  toggleRecent: () => {
    set({ expandedRecent: !get().expandedRecent });
    get().saveExpand();
  },

  expandAll: () => {
    const { rootProject, projects } = get();
    const next = new Set(get().expandedProjects);
    if (rootProject.tasks.length > 0 && projects.length > 0) {
      next.add(rootProject.relativePath);
    }
    for (const p of projects) next.add(p.relativePath);
    set({ expandedProjects: next, expandedPinned: true, expandedRecent: true });
    get().saveExpand();
  },
  collapseAll: () => {
    set({
      expandedProjects: new Set(),
      expandedPinned: false,
      expandedRecent: false,
    });
    get().saveExpand();
  },

  run: async (id) => {
    // 乐观：立即标记运行，refresh 后 host isRunning 接管
    const next = new Set(get().optimisticRunningIds);
    next.add(id);
    set({ optimisticRunningIds: next });
    try {
      await bridge.request("runTask", { id });
    } catch (err) {
      console.error("runTask failed:", err);
      // 失败：回退乐观态
      const rollback = new Set(get().optimisticRunningIds);
      rollback.delete(id);
      set({ optimisticRunningIds: rollback });
    }
  },
  stop: async (id) => {
    try {
      await bridge.request("stopTask", { id });
    } catch (err) {
      console.error("stopTask failed:", err);
    }
  },
  pin: async (id) => {
    try {
      await bridge.request("pinTask", { id });
    } catch (err) {
      console.error("pinTask failed:", err);
    }
  },
  unpin: async (id) => {
    try {
      await bridge.request("unpinTask", { id });
    } catch (err) {
      console.error("unpinTask failed:", err);
    }
  },
  removeRecent: async (id) => {
    try {
      await bridge.request("removeRecentRun", { id });
    } catch (err) {
      console.error("removeRecentRun failed:", err);
    }
  },
  reorder: async (dragId, targetId, position) => {
    try {
      await bridge.request("reorderTasks", { dragId, targetId, position });
    } catch (err) {
      console.error("reorderTasks failed:", err);
    }
  },

  isRunning: (id) => {
    return get().optimisticRunningIds.has(id);
  },
}));

// ── 事件订阅（模块级）──
bridge.onEvent((event) => {
  if (event === EVENT_CHANGED) {
    void useTaskStore.getState().refresh();
  } else if (event === EVENT_EXPAND_ALL) {
    useTaskStore.getState().expandAll();
  } else if (event === EVENT_COLLAPSE_ALL) {
    useTaskStore.getState().collapseAll();
  }
});
