import * as vscode from "vscode";
import { MessageRouter } from "../messages/messageRouter";
import { GitService } from "./gitService";
import { RepoRegistry } from "./repoRegistry";
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
 * 多 repo（阶段 A）：RepoRegistry 负责扫描 workspace 根 + 1 层子目录的
 * git 仓库，为每个 repo 创建独立的 GitService + GitWatcher，并维护一个
 * "当前 repo"。panel / commit / diff editor 通过 ctx.gitService（= registry
 * .getCurrent() 的 getter 别名）共享当前 repo。
 *
 * 装配顺序：
 *   a. MessageRouter 单例（所有 webview 共享）
 *   b. workspace roots → RepoRegistry.init（内部创建 service + watcher）
 *   c. GitContentProvider / DiffEditorManager（绑定到 registry.getCurrent()，
 *      切换 repo 时的适配留后续优化 —— 见 TODO 注释）
 *   d. ReactViewProvider × 2（gitLog / commitPanel）
 *   e. Manager / Panel 实例（merge / conflicts / push / rollback）
 *   f. 构造 GitHandlerContext（registry + getter 形式的 gitService）
 *   g. 注册 handler + command + 临时调试命令
 *   h. 状态栏项
 *   i. 全部 disposable push 到 context.subscriptions
 */
export async function setupGit(context: vscode.ExtensionContext): Promise<void> {
  // a. MessageRouter 单例（所有 webview 共享）
  const messageRouter = new MessageRouter();

  // b. 处理 workspace folders → RepoRegistry
  const allWorkspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(
    (f) => f.uri.fsPath,
  );
  const workspaceRoot = allWorkspaceRoots[0];

  // 临时存储 shelf diff 内容（base/modified 虚拟 URI → 文本）
  const shelfDiffContent = new Map<string, string>();

  // RepoRegistry 内部为每个 repo 创建 GitService + GitWatcher，
  // setupGit 不再手动遍历创建 service / watcher。
  const registry = new RepoRegistry(messageRouter, context);
  await registry.init(allWorkspaceRoots);
  context.subscriptions.push(registry);

  // c. GitContentProvider / DiffEditorManager
  //
  // TODO: 切换 repo 时 GitContentProvider 适配，后续优化。
  // 当前绑定到启动时的 registry.getCurrent()。diff 视图的虚拟文档读取
  // 仍走初始 repo；切换 repo 后需要重建或改为延迟从 registry 取。
  const gitService = registry.getCurrent();

  let diffManager: DiffEditorManager | null = null;

  if (gitService) {
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

    // TODO: 切换 repo 时 DiffEditor 适配，后续优化。
    diffManager = new DiffEditorManager(gitService);
  }

  // d. 注册 WebviewViewProvider
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

  // e. 创建 Manager / Panel 实例（按各自构造签名）
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

  // f. 构造 GitHandlerContext（共享给所有 handler 注册函数）
  //
  //    gitService 用 getter 形式：始终返回 registry.getCurrent()，这样
  //    切换 repo 后所有读取 ctx.gitService 的 handler 自动跟随。
  const ctx: GitHandlerContext = {
    messageRouter,
    registry,
    get gitService() {
      return registry.getCurrent();
    },
    diffManager,
    mergeManager,
    conflictsManager,
    pushPanel,
    rollbackPanel,
    workspaceRoot,
    shelfDiffContent,
  };

  // g. 注册 handler（MessageRouter）和 command（VSCode commands）
  registerGitHandlers(ctx);
  registerGitCommands(context, ctx);

  // h. 临时调试命令（不进 package.json contributes，仅内部 registerCommand
  //    用于阶段 A 手测后端联动）
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "git-atlas._debugSwitchRepo",
      async () => {
        const repos = registry.getRepoInfos();
        if (repos.length === 0) {
          void vscode.window.showWarningMessage("No repos found");
          return;
        }
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({
            label: r.name,
            description: r.path,
            picked: r.path === registry.getCurrentRepoPath(),
          })),
          { placeHolder: "Switch current repo" },
        );
        if (pick?.description) {
          await registry.setCurrent(pick.description);
        }
      },
    ),
  );

  // i. 状态栏项（快速打开 Git Log panel）
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
