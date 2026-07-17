import * as vscode from "vscode";
import * as crypto from "crypto";
import type {
  TodoItem,
  TodoPriority,
  TodoScope,
  TodoStoreData,
  TodoTag,
} from "../models/todo";
import {
  NodeFsScanner,
  type ScanOptions,
  type TodoScanner,
} from "../todo/scanner";
import { scanRepos } from "../git/repoScanner";
import { normalizePath } from "../git/repoPaths";

/**
 * Todo Atlas 服务。镜像 TaskService 模式：
 *   - 无参构造 + initStorage 延迟注入 memento
 *   - 自有 _onDidChange，不经 StorageService
 *   - globalState key "todoAtlas.data" 持久化手动 todo（global + projects 分桶）
 *   - 扫描 todo 仅内存缓存（cachedScanTodos + scanByFile），由 watcher 失效
 *
 * 手动写操作结尾调 persist()（update + fire onDidChange）；扫描操作不 fire
 * （由 setupTodo 决定何时广播 todosChanged）。
 */

/** 默认标签词集合（todoAtlas.scan.tags 未配置时回退）。 */
const DEFAULT_TAGS: TodoTag[] = ["TODO", "FIXME", "XXX", "HACK", "BUG", "NOTE"];

/** 默认 exclude globs（todoAtlas.scan.exclude 未配置时回退）。 */
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/.vscode-test/**",
  "**/*.min.js",
  "**/*.map",
];

const STORAGE_KEY = "todoAtlas.data";

export class TodoService implements vscode.Disposable {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _memento: vscode.Memento | undefined;
  private data: TodoStoreData = { version: 1, global: [], projects: {} };

  /** 扫描缓存：扁平列表。undefined 表示未扫描。 */
  private cachedScanTodos: TodoItem[] | undefined;
  private scanPromise: Promise<TodoItem[]> | undefined;
  /** workspaceState（按工作区持久化扫描缓存，重开时秒显）。 */
  private wsMemento: vscode.Memento | undefined;
  /** 本次会话是否已实际扫描校验（持久化加载的缓存为 false，需后台重扫）。 */
  private scanVerified = false;
  /** 是否正在执行全量扫描（doScan 运行中）。 */
  private scanning = false;
  /** 扫描缓存：按 file fsPath 分桶，用于增量 rescanFile。 */
  private scanByFile = new Map<string, TodoItem[]>();

  private scanner: TodoScanner;

  constructor(scanner?: TodoScanner) {
    this.scanner = scanner ?? new NodeFsScanner();
  }

  /** 从 globalState 加载持久化数据。activate 早期调用。 */
  initStorage(memento: vscode.Memento): void {
    this._memento = memento;
    this.data = memento.get<TodoStoreData>(STORAGE_KEY, {
      version: 1,
      global: [],
      projects: {},
    });
  }

  // --- 手动 CRUD ---

  /**
   * 返回当前应展示的手动 todo：
   *   - global：data.global（全工作区共享）
   *   - project：聚合所有 workspaceId 的 projects[id]（多根合并）
   */
  getManualTodos(workspaceIds?: string[]): { global: TodoItem[]; project: TodoItem[] } {
    const project: TodoItem[] = [];
    const keys = workspaceIds ?? Object.keys(this.data.projects);
    for (const wsId of keys) {
      const list = this.data.projects[wsId];
      if (list) project.push(...list);
    }
    return { global: this.data.global, project };
  }

  /**
   * 识别当前工作区的子项目（复用 Git Atlas 的 repoScanner）。
   * 返回 {uri, name}[]：有 git repo 时列 repo（root + 1 层子 repo）；
   * 无 repo 时 fallback workspaceFolders。
   */
  async getSubProjects(): Promise<{ uri: string; name: string }[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const roots = folders.map((f) => f.uri.fsPath);
    if (roots.length === 0) return [];

    const result: { uri: string; name: string }[] = [];
    const seen = new Set<string>();

    // 首位：workspace root（根目录）
    for (const f of folders) {
      const normalized = normalizePath(f.uri.fsPath);
      if (!seen.has(normalized)) {
        result.push({ uri: normalized, name: f.name });
        seen.add(normalized);
      }
    }

    // 子 repo（排除已添加的 root）
    try {
      const repos = await scanRepos(roots);
      for (const r of repos) {
        if (!seen.has(r.path)) {
          result.push({ uri: r.path, name: r.name });
          seen.add(r.path);
        }
      }
    } catch {
      // scan 失败：至少返回 root
    }

    return result;
  }

  addTodo(input: {
    scope: TodoScope;
    text: string;
    tag?: TodoTag;
    priority?: TodoPriority;
    workspaceId?: string;
  }): TodoItem {
    const now = Date.now();
    const workspaceId = input.workspaceId ?? this.getCurrentWorkspaceId();
    const id = this.makeManualId(input.scope, workspaceId);
    const item: TodoItem = {
      id,
      source: "manual",
      scope: input.scope,
      status: "pending",
      createdAt: now,
      text: input.text,
      tag: input.tag,
      priority: input.priority,
      ...(input.scope === "project" && workspaceId
        ? { workspaceId }
        : {}),
    };

    if (input.scope === "global") {
      this.data.global.push(item);
    } else if (input.scope === "project" && workspaceId) {
      if (!this.data.projects[workspaceId]) {
        this.data.projects[workspaceId] = [];
      }
      this.data.projects[workspaceId].push(item);
    } else {
      // project scope 但无工作区：降级为 global。
      this.data.global.push({ ...item, scope: "global" });
    }

    this.persist();
    return item;
  }

  updateTodo(
    id: string,
    patch: Partial<Pick<TodoItem, "text" | "tag" | "priority" | "scope">>,
  ): void {
    const found = this.findManualMutable(id);
    if (!found) return;
    const { item } = found;

    // scope 变更需跨桶迁移。
    if (patch.scope && patch.scope !== item.scope) {
      this.removeManualById(id);
      const wsId = this.getCurrentWorkspaceId();
      const newItem: TodoItem = {
        ...item,
        ...patch,
        scope: patch.scope,
        workspaceId: patch.scope === "project" ? wsId : undefined,
        updatedAt: Date.now(),
      };
      if (patch.scope === "global") {
        this.data.global.push(newItem);
      } else if (patch.scope === "project" && wsId) {
        if (!this.data.projects[wsId]) this.data.projects[wsId] = [];
        this.data.projects[wsId].push(newItem);
      }
      this.persist();
      return;
    }

    if (patch.text !== undefined) item.text = patch.text;
    if (patch.tag !== undefined) item.tag = patch.tag;
    if (patch.priority !== undefined) item.priority = patch.priority;
    item.updatedAt = Date.now();
    this.persist();
  }

  deleteTodo(id: string): void {
    if (this.removeManualById(id)) {
      this.persist();
    }
  }

  toggleTodo(id: string): void {
    const found = this.findManualMutable(id);
    if (!found) return;
    const { item } = found;
    if (item.status === "pending") {
      item.status = "completed";
      item.completedAt = Date.now();
    } else {
      item.status = "pending";
      item.completedAt = undefined;
    }
    item.updatedAt = Date.now();
    this.persist();
  }

  /** 按 orderedIds 重排 global 或指定工作区的 project 桶。 */
  reorderTodos(scope: TodoScope, orderedIds: string[], workspaceId?: string): void {
    if (scope === "global") {
      this.data.global = this.applyOrder(this.data.global, orderedIds);
      this.persist();
      return;
    }
    const wsId = workspaceId ?? this.getCurrentWorkspaceId();
    if (!wsId) return;
    const list = this.data.projects[wsId];
    if (!list) return;
    this.data.projects[wsId] = this.applyOrder(list, orderedIds);
    this.persist();
  }

  // --- 扫描 ---

  /**
   * 全量扫描。force 或无缓存时执行 scanner.scanAll；否则返回缓存。
   * 不 fire onDidChange（由调用方广播）。
   */
  async scanTodos(force?: boolean): Promise<TodoItem[]> {
    if (!force && this.cachedScanTodos) {
      return this.cachedScanTodos;
    }
    if (!force && this.scanPromise) {
      return this.scanPromise;
    }
    const p = this.doScan();
    if (!force) this.scanPromise = p;
    return p;
  }

  private async doScan(): Promise<TodoItem[]> {
    this.scanning = true;
    try {
      const result = await this.scanner.scanAll(this.getScanOptions());
      this.cachedScanTodos = result.todos;
      this.scanByFile = result.byFile;
      this.scanVerified = true;
      this.persistScanCache();
      return result.todos;
    } finally {
      this.scanning = false;
      this.scanPromise = undefined;
    }
  }

  /** 同步返回扫描缓存（未扫描时 undefined）。 */
  getCachedScanTodos(): TodoItem[] | undefined {
    return this.cachedScanTodos;
  }

  /** 本次会话是否已实际扫描校验。 */
  isScanVerified(): boolean {
    return this.scanVerified;
  }

  /** 是否正在扫描。 */
  isScanning(): boolean {
    return this.scanning;
  }

  /** 注入 workspaceState 并加载持久化扫描缓存（重开时秒显，后台重扫校验）。 */
  initWorkspaceStorage(memento: vscode.Memento): void {
    this.wsMemento = memento;
    const persisted = memento.get<
      { todos?: TodoItem[]; byFile?: Record<string, TodoItem[]> } | undefined
    >("todoAtlas.scanCache");
    if (persisted?.todos) {
      this.cachedScanTodos = persisted.todos;
      this.scanByFile = new Map(Object.entries(persisted.byFile ?? {}));
      // scanVerified 保持 false → getTodos 后台 force 重扫校验
    }
  }

  /** 持久化扫描缓存到 workspaceState。 */
  private persistScanCache(): void {
    if (!this.wsMemento) return;
    const data = {
      todos: this.cachedScanTodos ?? [],
      byFile: Object.fromEntries(this.scanByFile.entries()),
    };
    void this.wsMemento.update("todoAtlas.scanCache", data);
  }

  /**
   * 增量重扫单个文件：scanner.scanFile → 更新 scanByFile → 重建扁平缓存。
   * 不 fire（由调用方广播）。
   */
  rescanFile(fileUri: vscode.Uri): void {
    const options = this.getScanOptions();
    const items = this.scanner.scanFile(fileUri, options);
    const key = fileUri.fsPath;
    this.scanByFile.delete(key);
    if (items.length > 0) {
      this.scanByFile.set(key, items);
    }
    this.cachedScanTodos = this.flattenByFile();
    this.persistScanCache();
  }

  invalidateScanCache(): void {
    this.cachedScanTodos = undefined;
    this.scanByFile.clear();
    this.scanVerified = false;
    if (this.wsMemento) void this.wsMemento.update("todoAtlas.scanCache", undefined);
  }

  getScannedTodoById(id: string): TodoItem | undefined {
    return this.cachedScanTodos?.find((t) => t.id === id);
  }

  // --- 工作区 ---

  /** 当前工作区 id：首个 workspace folder 的 uri.toString()。 */
  getCurrentWorkspaceId(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.toString();
  }

  /** 所有工作区 id。 */
  getAllWorkspaceIds(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString());
  }

  // --- 配置读取 ---

  getScanOptions(): ScanOptions {
    const cfg = vscode.workspace.getConfiguration("todoAtlas.scan");
    const tags = cfg.get<TodoTag[]>("tags", DEFAULT_TAGS);
    const excludeGlobs = cfg.get<string[]>("exclude", DEFAULT_EXCLUDES);
    return {
      tags: tags.length > 0 ? tags : DEFAULT_TAGS,
      excludeGlobs,
      workspaceFolders: vscode.workspace.workspaceFolders ?? [],
    };
  }

  getShowCompleted(): boolean {
    return vscode.workspace
      .getConfiguration("todoAtlas")
      .get<boolean>("showCompleted", true);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  // --- 私有 ---

  private persist(): void {
    this._memento?.update(STORAGE_KEY, this.data);
    this._onDidChange.fire();
  }

  /**
   * 在 global 或 projects 中按 id 查找可变引用。
   * 返回 { item, bucket } 便于就地修改。
   */
  private findManualMutable(
    id: string,
  ): { item: TodoItem; bucket: TodoItem[] } | undefined {
    for (const item of this.data.global) {
      if (item.id === id) return { item, bucket: this.data.global };
    }
    for (const wsId of Object.keys(this.data.projects)) {
      const list = this.data.projects[wsId];
      for (const item of list) {
        if (item.id === id) return { item, bucket: list };
      }
    }
    return undefined;
  }

  /** 从 global 或 projects 中按 id 移除。返回是否实际移除。 */
  private removeManualById(id: string): boolean {
    const idx = this.data.global.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.data.global.splice(idx, 1);
      return true;
    }
    for (const wsId of Object.keys(this.data.projects)) {
      const list = this.data.projects[wsId];
      const i = list.findIndex((t) => t.id === id);
      if (i >= 0) {
        list.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** 按 orderedIds 重排桶内顺序；未在 orderedIds 中的项保留并追加到末尾。 */
  private applyOrder(list: TodoItem[], orderedIds: string[]): TodoItem[] {
    const byId = new Map(list.map((t) => [t.id, t]));
    const result: TodoItem[] = [];
    const seen = new Set<string>();
    for (const id of orderedIds) {
      const t = byId.get(id);
      if (t && !seen.has(id)) {
        result.push(t);
        seen.add(id);
      }
    }
    for (const t of list) {
      if (!seen.has(t.id)) result.push(t);
    }
    return result;
  }

  /** 从 scanByFile 拍平重建扁平扫描缓存。 */
  private flattenByFile(): TodoItem[] {
    const out: TodoItem[] = [];
    for (const list of this.scanByFile.values()) {
      out.push(...list);
    }
    return out;
  }

  /** 构造手动 todo 的 id。 */
  private makeManualId(scope: TodoScope, workspaceId?: string): string {
    const uuid = crypto.randomUUID();
    if (scope === "global") return `manual::global::${uuid}`;
    const wsHash = workspaceId
      ? crypto.createHash("md5").update(workspaceId).digest("hex").slice(0, 8)
      : "noffs";
    return `manual::project::${wsHash}::${uuid}`;
  }
}
