import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { TaskItem, TaskSource, PackageManager } from "../models/task";

/** Glob exclude pattern for findFiles */
const EXCLUDE_PATTERN = "**/{node_modules,.git,dist,out,build,.vscode-test}/**";

export class TaskService {
  /** Running npm scripts: taskId → Terminal */
  private runningTerminals = new Map<string, vscode.Terminal>();
  /** Running vscode tasks: taskId → TaskExecution */
  private runningExecutions = new Map<string, vscode.TaskExecution>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  /** Persisted task order: map of task id to its ordinal position */
  private taskOrder = new Map<string, number>();
  private _memento: vscode.Memento | undefined;
  /** Cached task list; invalidated by file watchers via invalidateCache() */
  private cachedTasks: TaskItem[] | undefined;
  /** Detected package manager per task: taskId → PackageManager */
  private taskPackageManager = new Map<string, PackageManager>();

  /**
   * Invalidate the task cache. Called when file watchers detect changes.
   */
  invalidateCache(): void {
    this.cachedTasks = undefined;
    this.taskPackageManager.clear();
  }

  /**
   * Discover all tasks recursively from the workspace.
   * Scans all .vscode/tasks.json and package.json files, caches results.
   */
  async getTasks(): Promise<TaskItem[]> {
    if (this.cachedTasks) {
      return this.cachedTasks;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.cachedTasks = [];
      return this.cachedTasks;
    }

    const tasks: TaskItem[] = [];
    const visited = new Set<string>();

    for (const folder of workspaceFolders) {
      const workspaceRoot = folder.uri.fsPath;

      // Recursively discover task files using findFiles
      const pkgPattern = new vscode.RelativePattern(folder, "**/package.json");
      const pkgFiles = await vscode.workspace.findFiles(pkgPattern, EXCLUDE_PATTERN);

      const tasksPattern = new vscode.RelativePattern(folder, "**/.vscode/tasks.json");
      const tasksFiles = await vscode.workspace.findFiles(tasksPattern, EXCLUDE_PATTERN);

      // Deduplicate all file URIs
      for (const uri of tasksFiles) {
        const key = uri.fsPath;
        if (visited.has(key)) { continue; }
        visited.add(key);

        const { tasks: vscodeTasks, npmScripts } = this.parseVscodeTasks(uri, workspaceRoot);
        tasks.push(...vscodeTasks);

        // Check if the same directory has a package.json to exclude deduped npm scripts
        const vscodeDir = path.dirname(uri.fsPath);
        const projectDir = path.dirname(vscodeDir);
        const siblingPkg = pkgFiles.find(p => path.dirname(p.fsPath) === projectDir);
        if (siblingPkg && !visited.has(siblingPkg.fsPath + ":npm")) {
          visited.add(siblingPkg.fsPath + ":npm");
          // Build exclude set from tasks.json declarations:
          // - npmScripts: type:"npm" tasks already collected by their "script" property
          // - all task labels: non-npm tasks that shadow same-named scripts by convention
          const dedupExclude = new Set(npmScripts);
          for (const vt of vscodeTasks) {
            dedupExclude.add(vt.name);
          }
          const npmTasks = this.parseNpmScripts(siblingPkg, workspaceRoot, dedupExclude);
          tasks.push(...npmTasks);
        }
      }

      // Process remaining package.json files not handled above
      for (const uri of pkgFiles) {
        const key = uri.fsPath + ":npm";
        if (visited.has(key)) { continue; }
        visited.add(key);

        const npmTasks = this.parseNpmScripts(uri, workspaceRoot, new Set());
        tasks.push(...npmTasks);
      }
    }

    // Build package manager lookup map
    this.taskPackageManager.clear();
    for (const t of tasks) {
      this.taskPackageManager.set(t.id, t.packageManager);
    }

    // Apply persisted order
    if (this.taskOrder.size > 0) {
      tasks.sort((a, b) => {
        const oa = this.taskOrder.get(a.id);
        const ob = this.taskOrder.get(b.id);
        if (oa !== undefined && ob !== undefined) { return oa - ob; }
        if (oa !== undefined) { return -1; }
        if (ob !== undefined) { return 1; }
        return 0;
      });
    }

    this.cachedTasks = tasks;
    return tasks;
  }

  isRunning(taskId: string): boolean {
    return this.runningTerminals.has(taskId) || this.runningExecutions.has(taskId);
  }

  /**
   * Execute a task. For vscode tasks, use vscode.tasks.executeTask.
   * For npm scripts, run in integrated terminal with correct cwd.
   */
  async runTask(taskId: string): Promise<void> {
    if (this.isRunning(taskId)) {
      return;
    }

    this.addRecentRun(taskId);

    const { source, relativeDir, name } = this.parseTaskId(taskId);

    if (source === "npm") {
      const cwd = this.resolveCwd(relativeDir);
      await this.runNpmScript(taskId, name, cwd);
    } else if (source === "vscode") {
      const cwd = this.resolveCwd(relativeDir);
      await this.runVscodeTask(taskId, name, cwd, relativeDir);
    }
  }

  /**
   * Stop a running task by its ID.
   */
  stopTask(taskId: string): void {
    const terminal = this.runningTerminals.get(taskId);
    if (terminal) {
      terminal.dispose();
      this.runningTerminals.delete(taskId);
      this._onDidChange.fire();
      return;
    }
    const execution = this.runningExecutions.get(taskId);
    if (execution) {
      execution.terminate();
      this.runningExecutions.delete(taskId);
      this._onDidChange.fire();
    }
  }

  /**
   * Get all currently running task IDs.
   */
  getRunningTaskIds(): string[] {
    return [...this.runningTerminals.keys(), ...this.runningExecutions.keys()];
  }

  dispose(): void {
    for (const terminal of this.runningTerminals.values()) {
      terminal.dispose();
    }
    this.runningTerminals.clear();
    for (const execution of this.runningExecutions.values()) {
      execution.terminate();
    }
    this.runningExecutions.clear();
  }

  /**
   * Restore task order from memento storage.
   */
  initStorage(memento: vscode.Memento): void {
    this._memento = memento;
    const saved = memento.get<Record<string, number>>("taskAtlas.order", {});
    for (const [id, order] of Object.entries(saved)) {
      this.taskOrder.set(id, order);
    }
  }

  /**
   * Reorder a task relative to a target task.
   */
  async reorder(dragId: string, targetId: string, position?: string): Promise<void> {
    const tasks = await this.getTasks();
    const dragIdx = tasks.findIndex(t => t.id === dragId);
    const targetIdx = tasks.findIndex(t => t.id === targetId);
    if (dragIdx === -1 || targetIdx === -1) { return; }

    // Remove dragged item
    const [dragged] = tasks.splice(dragIdx, 1);

    // Find new target index (may have shifted after splice)
    let newIdx = tasks.findIndex(t => t.id === targetId);
    if (position === "after") { newIdx++; }

    tasks.splice(newIdx, 0, dragged);

    // Update order map
    tasks.forEach((t, i) => this.taskOrder.set(t.id, i));
    this.persistOrder();
    // Invalidate cache so next getTasks() picks up new order
    this.cachedTasks = undefined;
    this._onDidChange.fire();
  }

  // --- Package Manager Detection ---

  /**
   * Detect package manager based on lock files in the given directory.
   */
  private detectPackageManager(cwd: string): PackageManager {
    if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) { return "pnpm"; }
    if (fs.existsSync(path.join(cwd, "yarn.lock"))) { return "yarn"; }
    if (fs.existsSync(path.join(cwd, "bun.lockb")) || fs.existsSync(path.join(cwd, "bun.lock"))) { return "bun"; }
    return "npm";
  }

  // --- Recent Runs ---

  getRecentRunIds(): string[] {
    return this._memento?.get<string[]>("taskAtlas.recentRuns", []) || [];
  }

  addRecentRun(taskId: string): void {
    const ids = this.getRecentRunIds().filter(id => id !== taskId);
    ids.unshift(taskId);
    const max = vscode.workspace.getConfiguration("taskAtlas").get<number>("maxRecentRuns", 5);
    this._memento?.update("taskAtlas.recentRuns", ids.slice(0, max));
    this._onDidChange.fire();
  }

  removeRecentRun(taskId: string): void {
    const ids = this.getRecentRunIds().filter(id => id !== taskId);
    this._memento?.update("taskAtlas.recentRuns", ids);
    this._onDidChange.fire();
  }

  // --- Pinned Tasks ---

  getPinnedIds(): string[] {
    return this._memento?.get<string[]>("taskAtlas.pinned", []) || [];
  }

  pin(taskId: string): void {
    const ids = this.getPinnedIds();
    if (!ids.includes(taskId)) {
      ids.push(taskId);
      this._memento?.update("taskAtlas.pinned", ids);
    }
    this._onDidChange.fire();
  }

  unpin(taskId: string): void {
    const ids = this.getPinnedIds().filter(id => id !== taskId);
    this._memento?.update("taskAtlas.pinned", ids);
    this._onDidChange.fire();
  }

  // --- Config Getters ---

  getShowRecentRuns(): boolean {
    return vscode.workspace.getConfiguration("taskAtlas").get<boolean>("showRecentRuns", true);
  }

  getMaxRecentRuns(): number {
    return vscode.workspace.getConfiguration("taskAtlas").get<number>("maxRecentRuns", 5);
  }

  getShowPinned(): boolean {
    return vscode.workspace.getConfiguration("taskAtlas").get<boolean>("showPinned", true);
  }

  // --- Private ---

  /**
   * Parse a .vscode/tasks.json file.
   * @param fileUri URI of the discovered tasks.json
   * @param workspaceRoot Absolute path of the workspace folder root
   */
  private parseVscodeTasks(
    fileUri: vscode.Uri,
    workspaceRoot: string,
  ): { tasks: TaskItem[]; npmScripts: Set<string> } {
    const fsPath = fileUri.fsPath;
    if (!fs.existsSync(fsPath)) {
      return { tasks: [], npmScripts: new Set() };
    }

    try {
      const content = fs.readFileSync(fsPath, "utf-8");
      // Strip JSON comments (single-line //)
      const stripped = content.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(stripped);
      const tasksArray = parsed.tasks || parsed;
      if (!Array.isArray(tasksArray)) {
        return { tasks: [], npmScripts: new Set() };
      }

      // .vscode/tasks.json → cwd is the parent of .vscode/
      const cwd = path.dirname(path.dirname(fsPath));
      const relativeDir = toForwardSlash(path.relative(workspaceRoot, cwd));

      const tasks: TaskItem[] = [];
      const npmScripts = new Set<string>();

      for (const t of tasksArray) {
        // For type:"npm" tasks, label may be omitted — use script name as fallback
        const label = t.label || (t.type === "npm" ? t.script : undefined);
        if (!label) { continue; }
        const group = t.group && typeof t.group === "object" && t.group.kind
          ? this.groupLabel(t.group.kind)
          : typeof t.group === "string"
            ? this.groupLabel(t.group)
            : undefined;

        if (t.type === "npm") {
          npmScripts.add(t.script || label);
        }

        const id = relativeDir
          ? `vscode::${relativeDir}::${label}`
          : `vscode::${label}`;

        tasks.push({
          id,
          name: label,
          source: "vscode" as TaskSource,
          group,
          cwd,
          relativeDir,
          packageManager: "npm" as PackageManager,
        });
      }
      return { tasks, npmScripts };
    } catch {
      return { tasks: [], npmScripts: new Set() };
    }
  }

  /**
   * Parse npm scripts from a package.json file.
   * @param fileUri URI of the discovered package.json
   * @param workspaceRoot Absolute path of the workspace folder root
   * @param exclude Set of script names to skip (already declared in tasks.json)
   */
  private parseNpmScripts(
    fileUri: vscode.Uri,
    workspaceRoot: string,
    exclude: Set<string>,
  ): TaskItem[] {
    const fsPath = fileUri.fsPath;
    if (!fs.existsSync(fsPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(fsPath, "utf-8");
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts;
      if (!scripts || typeof scripts !== "object") {
        return [];
      }

      const cwd = path.dirname(fsPath);
      const relativeDir = toForwardSlash(path.relative(workspaceRoot, cwd));
      const packageManager = this.detectPackageManager(cwd);

      return Object.keys(scripts)
        .filter((name) => !exclude.has(name))
        .map((name) => {
          const id = relativeDir
            ? `npm::${relativeDir}::${name}`
            : `npm::${name}`;
          return {
            id,
            name,
            source: "npm" as TaskSource,
            group: vscode.l10n.t("npm Scripts"),
            cwd,
            relativeDir,
            packageManager,
          };
        });
    } catch {
      return [];
    }
  }

  private groupLabel(kind: string): string {
    const labels: Record<string, string> = {
      build: "Build",
      test: "Test",
    };
    return labels[kind] || kind;
  }

  /**
   * Parse a task ID into its components.
   * "npm::build" → { source: "npm", relativeDir: "", name: "build" }
   * "npm::packages/app::build" → { source: "npm", relativeDir: "packages/app", name: "build" }
   */
  private parseTaskId(taskId: string): { source: TaskSource; relativeDir: string; name: string } {
    const parts = taskId.split("::");
    const source = parts[0] as TaskSource;
    const name = parts[parts.length - 1];
    const relativeDir = parts.length > 2 ? parts.slice(1, -1).join("::") : "";
    return { source, relativeDir, name };
  }

  /**
   * Resolve a relativeDir back to an absolute path using workspace folders.
   */
  private resolveCwd(relativeDir: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return "";
    }
    if (!relativeDir) {
      return workspaceFolders[0].uri.fsPath;
    }
    return path.join(workspaceFolders[0].uri.fsPath, relativeDir);
  }

  private async runNpmScript(taskId: string, scriptName: string, cwd: string): Promise<void> {
    if (!cwd) {
      return;
    }

    const pm = this.taskPackageManager.get(taskId) || "npm";
    const runCmd = pm === "npm" ? `npm run ${scriptName}`
      : pm === "pnpm" ? `pnpm run ${scriptName}`
      : pm === "yarn" ? `yarn ${scriptName}`
      : `bun run ${scriptName}`;

    const terminal = vscode.window.createTerminal({
      name: `${pm}: ${scriptName}`,
      cwd,
    });
    terminal.show(true);
    terminal.sendText(runCmd);

    this.runningTerminals.set(taskId, terminal);
    this._onDidChange.fire();

    const cleanup = () => {
      if (this.runningTerminals.has(taskId)) {
        this.runningTerminals.delete(taskId);
        this._onDidChange.fire();
      }
      closeDisposable.dispose();
      shellEndDisposable.dispose();
    };

    const closeDisposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        cleanup();
      }
    });

    const shellEndDisposable = vscode.window.onDidEndTerminalShellExecution((e) => {
      if (e.terminal === terminal) {
        cleanup();
      }
    });
  }

  private async runVscodeTask(taskId: string, name: string, cwd: string, relativeDir: string): Promise<void> {
    // First try VS Code's built-in task discovery (works for root-level tasks)
    const allTasks = await vscode.tasks.fetchTasks();
    // Match by name AND scope to avoid wrong task in monorepos with duplicate labels
    const target = allTasks.find((t) => {
      const nameMatch = t.name === name || t.definition?.label === name;
      if (!nameMatch) { return false; }
      // If task has a WorkspaceFolder scope, verify it matches the expected cwd
      if (t.scope && typeof t.scope === "object" && "uri" in t.scope) {
        return (t.scope as vscode.WorkspaceFolder).uri.fsPath === cwd;
      }
      // Tasks without a specific scope (Workspace/Global) only match root-level requests
      return !relativeDir;
    });

    if (target) {
      const execution = await vscode.tasks.executeTask(target);
      this.runningExecutions.set(taskId, execution);
      this._onDidChange.fire();

      const disposable = vscode.tasks.onDidEndTask((e) => {
        if (e.execution === execution) {
          this.runningExecutions.delete(taskId);
          this._onDidChange.fire();
          disposable.dispose();
        }
      });
      return;
    }

    // Fallback for sub-project tasks: read tasks.json and run command in terminal
    if (relativeDir) {
      await this.runSubProjectTask(taskId, name, cwd);
      return;
    }

    vscode.window.showWarningMessage(
      vscode.l10n.t("Task '{0}' not found.", name)
    );
    this._onDidChange.fire();
  }

  /**
   * Execute a task from a sub-project's .vscode/tasks.json via terminal.
   * VS Code's fetchTasks() only discovers root-level tasks, so sub-project
   * tasks need to be run by reading the tasks.json and executing the command directly.
   */
  private async runSubProjectTask(taskId: string, name: string, cwd: string): Promise<void> {
    const tasksJsonPath = path.join(cwd, ".vscode", "tasks.json");
    if (!fs.existsSync(tasksJsonPath)) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Task '{0}' not found.", name)
      );
      return;
    }

    try {
      const content = fs.readFileSync(tasksJsonPath, "utf-8");
      const stripped = content.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(stripped);
      const tasksArray = parsed.tasks || parsed;

      if (!Array.isArray(tasksArray)) {
        vscode.window.showWarningMessage(
          vscode.l10n.t("Task '{0}' not found.", name)
        );
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskDef = tasksArray.find((t: any) => t.label === name);
      if (!taskDef) {
        vscode.window.showWarningMessage(
          vscode.l10n.t("Task '{0}' not found.", name)
        );
        return;
      }

      // Resolve the command to execute
      let command: string;
      if (taskDef.type === "npm") {
        const pm = this.taskPackageManager.get(taskId) || "npm";
        const scriptName = taskDef.script || taskDef.label;
        command = pm === "npm" ? `npm run ${scriptName}`
          : pm === "pnpm" ? `pnpm run ${scriptName}`
          : pm === "yarn" ? `yarn ${scriptName}`
          : `bun run ${scriptName}`;
        // npm tasks should run from the project directory containing package.json
        // If taskDef.path is set, cwd is relative to the workspace folder
        if (taskDef.path) {
          cwd = path.join(cwd, taskDef.path);
        }
      } else if (taskDef.type === "shell" || taskDef.type === "process") {
        command = taskDef.command || "";
        if (taskDef.args && Array.isArray(taskDef.args)) {
          command += " " + taskDef.args.join(" ");
        }
      } else {
        command = taskDef.command || "";
      }

      if (!command) {
        vscode.window.showWarningMessage(
          vscode.l10n.t("Task '{0}' has no executable command.", name)
        );
        return;
      }

      // Execute via terminal (same lifecycle tracking as npm scripts)
      const terminal = vscode.window.createTerminal({
        name: name,
        cwd,
      });
      terminal.show(true);
      terminal.sendText(command);

      this.runningTerminals.set(taskId, terminal);
      this._onDidChange.fire();

      const cleanup = () => {
        if (this.runningTerminals.has(taskId)) {
          this.runningTerminals.delete(taskId);
          this._onDidChange.fire();
        }
        closeDisposable.dispose();
        shellEndDisposable.dispose();
      };

      const closeDisposable = vscode.window.onDidCloseTerminal((closed) => {
        if (closed === terminal) {
          cleanup();
        }
      });

      const shellEndDisposable = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.terminal === terminal) {
          cleanup();
        }
      });
    } catch {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Task '{0}' not found.", name)
      );
    }
  }

  private persistOrder(): void {
    if (!this._memento) { return; }
    const obj: Record<string, number> = {};
    for (const [id, order] of this.taskOrder) {
      obj[id] = order;
    }
    this._memento.update("taskAtlas.order", obj);
  }
}

/**
 * Normalize a file path to use forward slashes for consistent IDs.
 */
function toForwardSlash(p: string): string {
  return p.split(path.sep).join("/");
}
