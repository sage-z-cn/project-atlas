import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { TaskItem, TaskSource } from "../models/task";


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

  /**
   * Parse all tasks from the current workspace.
   * Reads .vscode/tasks.json and package.json scripts.
   */
  getTasks(): TaskItem[] {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const root = workspaceFolders[0].uri.fsPath;
    const tasks: TaskItem[] = [];

    // Parse .vscode/tasks.json (returns npm script names declared there for dedup)
    const { tasks: vscodeTasks, npmScripts } = this.parseVscodeTasks(root);
    tasks.push(...vscodeTasks);

    // Parse package.json scripts, excluding those already declared in tasks.json
    const npmTasks = this.parseNpmScripts(root, npmScripts);
    tasks.push(...npmTasks);

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

    return tasks;
  }

  isRunning(taskId: string): boolean {
    return this.runningTerminals.has(taskId) || this.runningExecutions.has(taskId);
  }

  /**
   * Execute a task. For vscode tasks, use vscode.tasks.executeTask.
   * For npm scripts, run in integrated terminal.
   */
  async runTask(taskId: string): Promise<void> {
    if (this.isRunning(taskId)) {
      return;
    }

    const [source, ...rest] = taskId.split("::");
    const name = rest.join("::");

    if (source === "npm") {
      await this.runNpmScript(taskId, name);
    } else if (source === "vscode") {
      await this.runVscodeTask(taskId, name);
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
  reorder(dragId: string, targetId: string, position?: string): void {
    const tasks = this.getTasks();
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
    this._onDidChange.fire();
  }

  // --- Private ---

  private parseVscodeTasks(root: string): { tasks: TaskItem[]; npmScripts: Set<string> } {
    const tasksJsonPath = path.join(root, ".vscode", "tasks.json");
    if (!fs.existsSync(tasksJsonPath)) {
      return { tasks: [], npmScripts: new Set() };
    }

    try {
      const content = fs.readFileSync(tasksJsonPath, "utf-8");
      // Strip JSON comments (single-line //)
      const stripped = content.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(stripped);
      const tasksArray = parsed.tasks || parsed;
      if (!Array.isArray(tasksArray)) {
        return { tasks: [], npmScripts: new Set() };
      }

      const tasks: TaskItem[] = [];
      const npmScripts = new Set<string>();

      for (const t of tasksArray) {
        if (!t.label) { continue; }
        const group = t.group && typeof t.group === "object" && t.group.kind
          ? this.groupLabel(t.group.kind)
          : typeof t.group === "string"
            ? this.groupLabel(t.group)
            : undefined;

        if (t.type === "npm") {
          // Track which npm scripts are declared in tasks.json
          npmScripts.add(t.script || t.label);
        }
        // Include all tasks (including npm-type) from tasks.json
        tasks.push({
          id: `vscode::${t.label}`,
          name: t.label,
          source: "vscode" as TaskSource,
          group,
        });
      }
      return { tasks, npmScripts };
    } catch {
      return { tasks: [], npmScripts: new Set() };
    }
  }

  private parseNpmScripts(root: string, exclude: Set<string>): TaskItem[] {
    const pkgPath = path.join(root, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts;
      if (!scripts || typeof scripts !== "object") {
        return [];
      }

      return Object.keys(scripts)
        .filter((name) => !exclude.has(name))
        .map((name) => ({
          id: `npm::${name}`,
          name,
          source: "npm" as TaskSource,
          group: vscode.l10n.t("npm Scripts"),
        }));
    } catch {
      return [];
    }
  }

  private groupLabel(kind: string): string {
    // Standard vscode task groups: build, test, clean, rebuild
    const labels: Record<string, string> = {
      build: "Build",
      test: "Test",
    };
    return labels[kind] || kind;
  }

  private async runNpmScript(taskId: string, scriptName: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }
    const cwd = workspaceFolders[0].uri.fsPath;

    const terminal = vscode.window.createTerminal({
      name: `npm: ${scriptName}`,
      cwd,
    });
    terminal.show(true);
    terminal.sendText(`npm run ${scriptName}`);

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

    // Track terminal close
    const closeDisposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        cleanup();
      }
    });

    // Track shell process exit (fires when command finishes, even if terminal stays open)
    const shellEndDisposable = vscode.window.onDidEndTerminalShellExecution((e) => {
      if (e.terminal === terminal) {
        cleanup();
      }
    });
  }

  private async runVscodeTask(taskId: string, name: string): Promise<void> {
    const allTasks = await vscode.tasks.fetchTasks();
    const target = allTasks.find(
      (t) => t.name === name || t.definition?.label === name
    );

    if (!target) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Task '{0}' not found.", name)
      );
      return;
    }

    const execution = await vscode.tasks.executeTask(target);
    this.runningExecutions.set(taskId, execution);
    this._onDidChange.fire();

    // Track task end
    const disposable = vscode.tasks.onDidEndTask((e) => {
      if (e.execution === execution) {
        this.runningExecutions.delete(taskId);
        this._onDidChange.fire();
        disposable.dispose();
      }
    });
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
