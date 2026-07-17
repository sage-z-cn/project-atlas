import * as vscode from "vscode";
import type { MessageRouter } from "../../messages/messageRouter";
import type { TodoService } from "../../services/todoService";
import type {
  TodoItem,
  TodoPriority,
  TodoScope,
  TodoTag,
} from "../../models/todo";

/** Todo 子系统 host 上下文。Todo 有独立的 MessageRouter（自有 onDidChange）。 */
export interface TodoHandlerContext {
  messageRouter: MessageRouter;
  context: vscode.ExtensionContext;
  todoService: TodoService;
}

/** todo router 广播的事件名（webview 端需用相同字符串监听）。 */
export const TODO_EVENTS = {
  /** todoService.onDidChange / watcher 重扫 / 窗口聚焦 / todoAtlas 配置变化 → webview 重拉 getTodos。 */
  changed: "todosChanged",
  /** view/title 命令 todo-atlas.expandAll 触发。 */
  expandAll: "expandAllRequested",
  /** view/title 命令 todo-atlas.collapseAll 触发。 */
  collapseAll: "collapseAllRequested",
} as const;

export interface TodoItemDto {
  id: string;
  source: "manual" | "scan";
  scope?: "global" | "project";
  status: "pending" | "completed";
  text: string;
  tag?: TodoTag;
  priority?: TodoPriority;
  file?: string;
  relativePath?: string;
  line?: number;
  column?: number;
  assignee?: string;
  createdAt?: number;
  completedAt?: number;
  /** project 级 TODO 归属的工作区/repo 标识。 */
  workspaceId?: string;
}

export interface TodosDataDto {
  /** scope=global 的手动 todo。 */
  globalManual: TodoItemDto[];
  /** scope=project 的手动 todo（聚合当前所有 workspaceId）。 */
  projectManual: TodoItemDto[];
  /** 代码扫描 todo（内存缓存）。 */
  scanned: TodoItemDto[];
  /** 工作区名（无工作区时 "No Workspace"）。 */
  workspaceName: string;
  /** 是否正在扫描（当前实现：getTodos 同步返回缓存，恒 false）。 */
  scanning: boolean;
  /** 工作区 folder 列表（多根时供 webview 选择归属）。 */
  workspaceFolders: { uri: string; name: string }[];
}

function toDto(item: TodoItem): TodoItemDto {
  const dto: TodoItemDto = {
    id: item.id,
    source: item.source,
    status: item.status,
    text: item.text,
  };
  if (item.scope !== undefined) dto.scope = item.scope;
  if (item.tag !== undefined) dto.tag = item.tag;
  if (item.priority !== undefined) dto.priority = item.priority;
  if (item.file !== undefined) dto.file = item.file;
  if (item.relativePath !== undefined) dto.relativePath = item.relativePath;
  if (item.line !== undefined) dto.line = item.line;
  if (item.column !== undefined) dto.column = item.column;
  if (item.assignee !== undefined) dto.assignee = item.assignee;
  if (item.createdAt !== undefined) dto.createdAt = item.createdAt;
  if (item.completedAt !== undefined) dto.completedAt = item.completedAt;
  if (item.workspaceId !== undefined) dto.workspaceId = item.workspaceId;
  return dto;
}

/** 工作区名：vscode.workspace.name，无工作区时 "No Workspace"。 */
function getWorkspaceName(): string {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return vscode.l10n.t("No Workspace");
  }
  return vscode.workspace.name ?? vscode.l10n.t("Workspace");
}

/** 注册 Todo 面板的全部 MessageRouter handler（8 个命令）。 */
export function registerTodoHandlers(ctx: TodoHandlerContext): void {
  const { messageRouter, todoService } = ctx;

  messageRouter.handle("getTodos", async (): Promise<TodosDataDto> => {
    const folders = await todoService.getSubProjects();
    const { global, project } = todoService.getManualTodos(
      folders.map((f) => f.uri),
    );
    const autoScan = vscode.workspace
      .getConfiguration("todoAtlas.scan")
      .get<boolean>("autoScan", false);
    let scanned: TodoItem[] = [];
    const cached = todoService.getCachedScanTodos();
    if (cached !== undefined) {
      scanned = cached;
      // 持久化缓存未校验（重开 VSCode）：仅 autoScan 时后台 force 重扫校验，完成广播
      if (autoScan && !todoService.isScanVerified()) {
        void todoService.scanTodos(true).then(() => {
          messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
        });
      }
    } else if (autoScan) {
      // 首次且 autoScan：后台扫描，完成后广播刷新（手动 TODO 已先返回）
      void todoService.scanTodos().then(() => {
        messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
      });
    }
    return {
      globalManual: global.map(toDto),
      projectManual: project.map(toDto),
      scanned: scanned.map(toDto),
      workspaceName: getWorkspaceName(),
      scanning: todoService.isScanning(),
      workspaceFolders: folders,
    };
  });

  messageRouter.handle("addTodo", async (params) => {
    const scope = (params.scope as TodoScope) ?? "global";
    const text = (params.text as string) ?? "";
    if (!text) return { id: "" };
    const tag = params.tag as TodoTag | undefined;
    const priority = params.priority as TodoPriority | undefined;
    const workspaceId = params.workspaceId as string | undefined;
    const item = todoService.addTodo({ scope, text, tag, priority, workspaceId });
    return { id: item.id };
  });

  messageRouter.handle("updateTodo", async (params) => {
    const id = params.id as string;
    if (!id) return;
    const patch: {
      text?: string;
      tag?: TodoTag;
      priority?: TodoPriority;
      scope?: TodoScope;
    } = {};
    if (typeof params.text === "string") patch.text = params.text;
    if (params.tag !== undefined) patch.tag = params.tag as TodoTag;
    if (params.priority !== undefined) patch.priority = params.priority as TodoPriority;
    if (params.scope !== undefined) patch.scope = params.scope as TodoScope;
    todoService.updateTodo(id, patch);
  });

  messageRouter.handle("deleteTodo", async (params) => {
    const id = params.id as string;
    if (id) todoService.deleteTodo(id);
  });

  messageRouter.handle("toggleTodo", async (params) => {
    const id = params.id as string;
    if (id) todoService.toggleTodo(id);
  });

  messageRouter.handle("reorderTodos", async (params) => {
    const scope = (params.scope as TodoScope) ?? "global";
    const orderedIds = (params.orderedIds as string[]) ?? [];
    const workspaceId = params.workspaceId as string | undefined;
    if (orderedIds.length > 0) {
      todoService.reorderTodos(scope, orderedIds, workspaceId);
    }
  });

  messageRouter.handle("refreshScanTodos", async () => {
    todoService.invalidateScanCache();
    await todoService.scanTodos(true);
  });

  messageRouter.handle("jumpToTodo", async (params) => {
    const id = params.id as string;
    if (!id) return;
    const item = todoService.getScannedTodoById(id);
    if (item?.file && item.line) {
      const doc = await vscode.workspace.openTextDocument(item.file);
      const pos = new vscode.Position(
        item.line - 1,
        Math.max(0, (item.column ?? 1) - 1),
      );
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
      });
    }
  });
}
