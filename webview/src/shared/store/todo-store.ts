import { create } from "zustand";
import { bridge } from "../bridge";
import type {
  TodoItemDto,
  TodoPriority,
  TodoScope,
  TodoTag,
  TodosDataDto,
  WorkspaceFolderInfo,
} from "../types/todo";

/** host router 广播的事件名（与 host todoHandlers TODO_EVENTS 一致）。 */
const EVENT_CHANGED = "todosChanged";
const EVENT_EXPAND_ALL = "expandAllRequested";
const EVENT_COLLAPSE_ALL = "collapseAllRequested";

interface PersistedExpand {
  expandedGroups?: string[];
}

interface TodoStore {
  globalManual: TodoItemDto[];
  projectManual: TodoItemDto[];
  scanned: TodoItemDto[];
  workspaceName: string;
  workspaceFolders: WorkspaceFolderInfo[];
  scanning: boolean;
  loading: boolean;
  /** 展开的组 key：manual 段为 "global"/"project"；scan 段根为 "scan-root"；scan tag 子组为 "scan:TODO" 等。 */
  expandedGroups: Set<string>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  saveExpand: () => void;

  add: (input: {
    scope: TodoScope;
    text: string;
    tag?: TodoTag;
    priority?: TodoPriority;
    workspaceId?: string;
  }) => Promise<void>;
  update: (
    id: string,
    patch: {
      text?: string;
      tag?: TodoTag;
      priority?: TodoPriority;
      scope?: TodoScope;
    },
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  jumpTo: (id: string) => Promise<void>;
  refreshScan: () => Promise<void>;
  reorder: (scope: TodoScope, orderedIds: string[], workspaceId?: string) => Promise<void>;

  toggleGroup: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  globalManual: [],
  projectManual: [],
  scanned: [],
  workspaceName: "",
  workspaceFolders: [],
  scanning: false,
  loading: true,
  expandedGroups: new Set<string>(),

  init: async () => {
    // 从 webview 持久态恢复展开状态（vscode.getState）
    const persisted = bridge.getState() as PersistedExpand | null;
    const firstLoad = !persisted || persisted.expandedGroups === undefined;
    if (persisted && persisted.expandedGroups) {
      set({ expandedGroups: new Set(persisted.expandedGroups) });
    }
    await get().refresh();
    // 首次加载自动展开全部组
    if (firstLoad) {
      get().expandAll();
    }
  },

  refresh: async () => {
    try {
      const data = (await bridge.request("getTodos")) as TodosDataDto;
      set({
        globalManual: data.globalManual ?? [],
        projectManual: data.projectManual ?? [],
        scanned: data.scanned ?? [],
        workspaceName: data.workspaceName ?? "",
        workspaceFolders: data.workspaceFolders ?? [],
        scanning: data.scanning ?? false,
        loading: false,
      });
    } catch (err) {
      console.error("getTodos failed:", err);
      set({ loading: false });
    }
  },

  saveExpand: () => {
    bridge.setState({ expandedGroups: [...get().expandedGroups] });
  },

  add: async (input) => {
    // 乐观：临时项插入对应 scope 列表，request 成功后用真实 id 替换
    const tempId = `temp-${Date.now()}`;
    const now = Date.now();
    const tempItem: TodoItemDto = {
      id: tempId,
      source: "manual",
      scope: input.scope,
      status: "pending",
      text: input.text,
      tag: input.tag,
      priority: input.priority,
      createdAt: now,
    };
    if (input.scope === "global") {
      set({ globalManual: [...get().globalManual, tempItem] });
    } else {
      set({ projectManual: [...get().projectManual, tempItem] });
    }
    try {
      const result = (await bridge.request("addTodo", input)) as
        | string
        | { id?: string }
        | undefined;
      const realId = typeof result === "string" ? result : result?.id;
      if (realId) {
        const replace = (list: TodoItemDto[]): TodoItemDto[] =>
          list.map((it) => (it.id === tempId ? { ...it, id: realId } : it));
        if (input.scope === "global") {
          set({ globalManual: replace(get().globalManual) });
        } else {
          set({ projectManual: replace(get().projectManual) });
        }
      }
    } catch (err) {
      console.error("addTodo failed:", err);
      // 失败：回滚临时项
      if (input.scope === "global") {
        set({ globalManual: get().globalManual.filter((it) => it.id !== tempId) });
      } else {
        set({ projectManual: get().projectManual.filter((it) => it.id !== tempId) });
      }
    }
  },

  update: async (id, patch) => {
    try {
      await bridge.request("updateTodo", { id, ...patch });
    } catch (err) {
      console.error("updateTodo failed:", err);
    }
  },

  remove: async (id) => {
    // 乐观移除（可能在 global 或 project 列表中）
    const prevGlobal = get().globalManual;
    const prevProject = get().projectManual;
    set({
      globalManual: prevGlobal.filter((it) => it.id !== id),
      projectManual: prevProject.filter((it) => it.id !== id),
    });
    try {
      await bridge.request("deleteTodo", { id });
    } catch (err) {
      console.error("deleteTodo failed:", err);
      set({ globalManual: prevGlobal, projectManual: prevProject });
    }
  },

  toggle: async (id) => {
    // 乐观翻转 status + 设/清 completedAt
    const prevGlobal = get().globalManual;
    const prevProject = get().projectManual;
    const flip = (list: TodoItemDto[]): TodoItemDto[] =>
      list.map((it) => {
        if (it.id !== id) return it;
        const wasCompleted = it.status === "completed";
        return {
          ...it,
          status: wasCompleted ? "pending" : "completed",
          completedAt: wasCompleted ? undefined : Date.now(),
        };
      });
    set({ globalManual: flip(prevGlobal), projectManual: flip(prevProject) });
    try {
      await bridge.request("toggleTodo", { id });
    } catch (err) {
      console.error("toggleTodo failed:", err);
      set({ globalManual: prevGlobal, projectManual: prevProject });
    }
  },

  jumpTo: async (id) => {
    try {
      await bridge.request("jumpToTodo", { id });
    } catch (err) {
      console.error("jumpToTodo failed:", err);
    }
  },

  refreshScan: async () => {
    try {
      await bridge.request("refreshScanTodos");
    } catch (err) {
      console.error("refreshScanTodos failed:", err);
    }
  },

  reorder: async (scope, orderedIds, workspaceId) => {
    if (scope === "global") {
      const prevList = get().globalManual;
      const byId = new Map(prevList.map((it) => [it.id, it] as const));
      const reordered: TodoItemDto[] = [];
      for (const id of orderedIds) {
        const it = byId.get(id);
        if (it) reordered.push(it);
      }
      for (const it of prevList) {
        if (!orderedIds.includes(it.id)) reordered.push(it);
      }
      set({ globalManual: reordered });
      try {
        await bridge.request("reorderTodos", { scope, orderedIds });
      } catch (err) {
        console.error("reorderTodos failed:", err);
        set({ globalManual: prevList });
      }
    } else {
      // project：只重排该 workspaceId 的项，其他 repo 保持原位
      const prevList = get().projectManual;
      const wsId = workspaceId ?? "";
      const idSet = new Set(orderedIds);
      const repoItems = prevList.filter((it) => (it.workspaceId ?? "") === wsId);
      const byId = new Map(repoItems.map((it) => [it.id, it] as const));
      const reorderedRepo: TodoItemDto[] = [];
      for (const id of orderedIds) {
        const it = byId.get(id);
        if (it) reorderedRepo.push(it);
      }
      for (const it of repoItems) {
        if (!idSet.has(it.id)) reorderedRepo.push(it);
      }
      let idx = 0;
      const newList = prevList.map((it) =>
        (it.workspaceId ?? "") === wsId ? reorderedRepo[idx++] : it,
      );
      set({ projectManual: newList });
      try {
        await bridge.request("reorderTodos", { scope, orderedIds, workspaceId });
      } catch (err) {
        console.error("reorderTodos failed:", err);
        set({ projectManual: prevList });
      }
    }
  },

  toggleGroup: (key) => {
    const next = new Set(get().expandedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set({ expandedGroups: next });
    get().saveExpand();
  },

  expandAll: () => {
    const { scanned } = get();
    const next = new Set<string>();
    next.add("global");
    next.add("project");
    if (scanned.length > 0) {
      next.add("scan-root");
      const tags = new Set<TodoTag>();
      for (const it of scanned) if (it.tag) tags.add(it.tag);
      for (const tag of tags) next.add(`scan:${tag}`);
    }
    set({ expandedGroups: next });
    get().saveExpand();
  },

  collapseAll: () => {
    set({ expandedGroups: new Set<string>() });
    get().saveExpand();
  },
}));

// ── 事件订阅（模块级）──
bridge.onEvent((event) => {
  if (event === EVENT_CHANGED) {
    void useTodoStore.getState().refresh();
  } else if (event === EVENT_EXPAND_ALL) {
    useTodoStore.getState().expandAll();
  } else if (event === EVENT_COLLAPSE_ALL) {
    useTodoStore.getState().collapseAll();
  }
});
