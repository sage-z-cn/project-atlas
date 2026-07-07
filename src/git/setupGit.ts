import * as vscode from "vscode";
import { MessageRouter } from "../messages/messageRouter";
import { GitService } from "./gitService";
import { GitWatcher } from "../watchers/gitWatcher";
import { ReactViewProvider } from "../webview/reactViewProvider";
import {
  GIT_ATLAS_SCHEME,
  GitContentProvider,
} from "../webview/gitContentProvider";
import { DiffEditorManager } from "../webview/diffEditorManager";
import { MergeEditorManager } from "../webview/mergeEditorManager";
import { ConflictsManager } from "../webview/conflictsManager";
import { PushPanel } from "../webview/pushPanel";
import { RollbackPanel } from "../webview/rollbackPanel";
import { registerGitHandlers } from "../commands/gitHandlers";
import { registerGitCommands } from "../commands/gitCommands";
import type { GitHandlerContext } from "../commands/gitContext";

/**
 * Git Atlas 模块化装配入口。
 *
 * 把所有 git 相关的 Service / Manager / Provider / Watcher / 命令 / 状态栏
 * 装配集中在一个函数里，与 Project Atlas 现有的装配逻辑完全解耦。
 * extension.ts 的 activate() 只需在末尾调用一次 setupGit(context)。
 *
 * 装配顺序忠实于参考项目 (.example/jetbrains-git-graph/src/extension.ts)：
 *   a. MessageRouter 单例
 *   b. workspace folders → GitService + GitContentProvider + DiffEditorManager
 *   c. ReactViewProvider × 2（gitLog / commitPanel）
 *   d. Manager / Panel 实例（merge / conflicts / push / rollback）
 *   e. 构造 GitHandlerContext
 *   f. 注册 handler + command
 *   g. GitWatcher（仅在 gitService 可用时）
 *   h. 状态栏项
 *   i. 全部 disposable push 到 context.subscriptions
 *
 * 无 workspace folder 时降级：gitService / diffManager 保持 null，
 * GitHandlerContext 仍然构造，handler 内部的 requireGit 守卫会返回
 * NOT_GIT_REPO sentinel，命令守卫会 noop。
 */
export function setupGit(context: vscode.ExtensionContext): void {
  // a. MessageRouter 单例（所有 webview 共享）
  const messageRouter = new MessageRouter();

  // b. 处理 workspace folders
  const allWorkspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(
    (f) => f.uri.fsPath,
  );
  const workspaceRoot = allWorkspaceRoots[0];

  // 临时存储 shelf diff 内容（base/modified 虚拟 URI → 文本）
  const shelfDiffContent = new Map<string, string>();

  const allGitServices: GitService[] = [];
  for (const root of allWorkspaceRoots) {
    allGitServices.push(new GitService(root));
  }

  let gitService: GitService | null = null;
  let diffManager: DiffEditorManager | null = null;

  if (workspaceRoot) {
    gitService = allGitServices[0] ?? new GitService(workspaceRoot);

    // 注册虚拟文档/文件系统 provider（git-atlas:/<path>?ref=<hash>）
    // 同时注册 TextDocumentContentProvider（文本 diff）和 FileSystemProvider
    // （二进制文件如图片），与参考项目一致。
    const contentProvider = new GitContentProvider(gitService);
    contentProvider.setExternalContentMap(shelfDiffContent);
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        GIT_ATLAS_SCHEME,
        contentProvider,
      ),
      vscode.workspace.registerFileSystemProvider(
        GIT_ATLAS_SCHEME,
        contentProvider,
        { isReadonly: true },
      ),
    );

    diffManager = new DiffEditorManager(gitService);
  }

  // c. 注册 WebviewViewProvider
  //    gitLog → panel 模式；commitPanel → commit 模式
  const logProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "panel",
  );
  const commitProvider = new ReactViewProvider(
    context.extensionUri,
    messageRouter,
    "commit",
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "git-atlas.gitLog",
      logProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      "git-atlas.commitPanel",
      commitProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // d. 创建 Manager / Panel 实例（按各自构造签名）
  const mergeManager = new MergeEditorManager(
    context.extensionUri,
    messageRouter,
  );
  const conflictsManager = new ConflictsManager(
    context.extensionUri,
    messageRouter,
  );
  const pushPanel = new PushPanel(context.extensionUri, messageRouter);
  const rollbackPanel = new RollbackPanel(context.extensionUri, messageRouter);

  // e. 构造 GitHandlerContext（共享给所有 handler 注册函数）
  const ctx: GitHandlerContext = {
    messageRouter,
    gitService,
    allGitServices,
    diffManager,
    mergeManager,
    conflictsManager,
    pushPanel,
    rollbackPanel,
    workspaceRoot,
    shelfDiffContent,
  };

  // f. 注册 handler（MessageRouter）和 command（VSCode commands）
  registerGitHandlers(ctx);
  registerGitCommands(context, ctx);

  // g. GitWatcher（仅在 gitService 可用时，监听 .git 目录变化）
  if (gitService && workspaceRoot) {
    const watcher = new GitWatcher(
      workspaceRoot,
      messageRouter,
      gitService.cache,
    );
    context.subscriptions.push(watcher);
  }

  // h. 状态栏项（快速打开 Git Log panel）
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.text = "$(git-branch) Git Atlas";
  statusBarItem.tooltip = "Open Git Atlas Panel";
  statusBarItem.command = "git-atlas.gitLog.focus";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}
