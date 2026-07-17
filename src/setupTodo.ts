import * as vscode from "vscode";
import { MessageRouter } from "./messages/messageRouter";
import { ReactViewProvider } from "./webview/reactViewProvider";
import { registerL10nBundleHandler } from "./messages/l10nHandler";
import {
  registerTodoHandlersAll,
  TODO_EVENTS,
  type TodoHandlerContext,
} from "./commands/todoHandlers";
import { isScanTarget } from "./todo/scanner";
import type { TodoService } from "./services/todoService";

/**
 * Todo Atlas 模块化装配入口。镜像 setupTask 结构。
 *
 * Todo 有独立的 MessageRouter + 自有 todoService.onDidChange（不经 StorageService）。
 * 装配内容：l10n handler、todo handlers（8 个命令）、ReactViewProvider(mode:"todos")、
 * onDidChange→广播、文本保存/变更 watcher（debounce 重扫，仅当 scan.autoScan）、
 * 启动时 autoScan 后台扫描一次、
 * todoAtlas 配置监听、窗口聚焦重扫、4 个 view/title 命令。
 *
 * 事件契约（webview 端用相同字符串监听）：
 *   - todosChanged：数据/扫描/配置/窗口聚焦变化 → webview 重拉 getTodos
 *   - expandAllRequested / collapseAllRequested：view/title 命令驱动
 */

/**
 * 简单 debounce（模块级工具）。返回的函数延后 `ms` 执行 fn；期间再次调用会重置计时。
 * 返回的对象带 cancel() 以便清理。
 */
function debounce(
  fn: (uri: vscode.Uri) => void,
  ms: number,
): ((uri: vscode.Uri) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: vscode.Uri | undefined;
  const wrapped = ((uri: vscode.Uri): void => {
    pending = uri;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (pending) {
        const u = pending;
        pending = undefined;
        fn(u);
      }
    }, ms);
  }) as ((uri: vscode.Uri) => void) & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pending = undefined;
  };
  return wrapped;
}

export function setupTodo(
  context: vscode.ExtensionContext,
  todoService: TodoService,
): void {
  const messageRouter = new MessageRouter();

  // 面板开关：setContext 控制 view 显隐（package.json views when: todoAtlas.enabled）
  const updatePanelVisible = (): void => {
    const enabled = vscode.workspace
      .getConfiguration("todoAtlas")
      .get<boolean>("enabled", false);
    void vscode.commands.executeCommand("setContext", "todoAtlas.enabled", enabled);
  };
  updatePanelVisible();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("todoAtlas.enabled")) updatePanelVisible();
    }),
  );

  registerL10nBundleHandler(messageRouter, context);

  const ctx: TodoHandlerContext = { messageRouter, context, todoService };
  registerTodoHandlersAll(ctx);

  // Todos 视图（React，mode="todos"）
  const todosProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "todos",
    "TODO Atlas",
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("todo-atlas.todos", todosProvider),
  );

  // todoService 状态变化（手动 CRUD）→ 广播
  context.subscriptions.push(
    todoService.onDidChange(() => {
      messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
    }),
  );

  // 配置读取助手
  const scanCfg = () => vscode.workspace.getConfiguration("todoAtlas.scan");
  const isAutoScanEnabled = () => scanCfg().get<boolean>("autoScan", false);

  // 启动时 autoScan → 后台扫描一次 + 广播（建立基线，不必等首次打开面板/窗口聚焦）。
  if (isAutoScanEnabled()) {
    void todoService.scanTodos(true).then(() => {
      messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
    });
  }

  // watcher：保存/编辑源码文件 → debounce 重扫 + 广播。
  // 仅当 scan.autoScan 为 true 时注册（避免 autoScan 关闭时
  // onDidChangeTextDocument 的每次按键开销）。切换配置需重载窗口生效。
  if (isAutoScanEnabled()) {
    const debounceMs = scanCfg().get<number>("debounceMs", 500);
    const rescanned = debounce((uri) => {
      todoService.rescanFile(uri);
      messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
    }, debounceMs);

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!isScanTarget(doc.uri)) return;
        rescanned(doc.uri);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!isScanTarget(e.document.uri)) return;
        rescanned(e.document.uri);
      }),
    );
  }

  // todoAtlas 配置变化 → 失效扫描缓存 + 广播
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("todoAtlas")) {
        todoService.invalidateScanCache();
        messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
      }
    }),
  );

  // 窗口聚焦 → autoScan 时强制重扫 + 广播
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused && isAutoScanEnabled()) {
        void todoService.scanTodos(true);
        messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
      }
    }),
  );

  // view/title 命令（manifest 引用，必须保留注册）
  context.subscriptions.push(
    vscode.commands.registerCommand("todo-atlas.refreshTodos", () => {
      // 不预先 invalidate：扫描期间保留旧缓存，doScan 完成后原子替换，避免列表闪烁清空
      void todoService.scanTodos(true).then(() => {
        messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
      });
      messageRouter.broadcastEvent(TODO_EVENTS.changed, {});
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("todo-atlas.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "todoAtlas");
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("todo-atlas.expandAll", () => {
      messageRouter.broadcastEvent(TODO_EVENTS.expandAll, {});
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("todo-atlas.collapseAll", () => {
      messageRouter.broadcastEvent(TODO_EVENTS.collapseAll, {});
    }),
  );
}
