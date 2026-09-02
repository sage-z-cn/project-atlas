import * as vscode from "vscode";
import { NOT_GIT_REPO, requireGit } from "../gitContext";
import type { GitHandlerContext } from "../gitContext";
import type { GitService } from "../../git/gitService";
import type { CommandHandler } from "../../messages/messageRouter";
import {
  GIT_ATLAS_SCHEME,
  encodeGitAtlasPath,
} from "../../webview/gitContentProvider";

/**
 * Stash handlers (git-stash based).
 *
 * 统一协议契约：所有命令的 params 均带 `repoPath`，stash 条目用完整 SHA
 * （`stashRef`）寻址 —— stash@{n} 会随栈的推入/弹出漂移，只用作显示。
 * stashChanges 的 `message` / `filePaths` 参数名保持不变；getStashes 不变。
 *
 * N4：requireGit 返回的 NOT_GIT_REPO 哨兵在本模块统一转为 throw，
 * 由 MessageRouter 包装成 error response 返回给 webview（webview 侧已
 * catch）。只改本模块，不动 gitContext.requireGit 与其他 handler。
 */
function requireGitOrThrow<T>(
  ctx: GitHandlerContext,
  handler: (
    gitService: GitService,
    params: Record<string, unknown>,
  ) => Promise<T>,
): CommandHandler {
  const guarded = requireGit(ctx, handler);
  return async (params) => {
    const result = await guarded(params);
    if (result === NOT_GIT_REPO) {
      throw new Error(vscode.l10n.t("No active repository."));
    }
    return result;
  };
}

export function registerStashHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "stashChanges",
    requireGitOrThrow(ctx, async (gitService, params) => {
      const message = params.message as string | undefined;
      const filePaths = params.filePaths as string[] | undefined;
      await gitService.stashChanges(message ?? "", filePaths);
      // 与 unstashChanges 对齐：stash 同时改变工作区与 stash 栈，
      // 除 commit 面板外也要让日志/状态视图刷新。
      messageRouter.broadcastEvent("commitStateChanged", {});
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "unstashChanges",
    requireGitOrThrow(ctx, async (gitService, params) => {
      const stashRef = params.stashRef as string;
      const drop = (params.drop as boolean) ?? true;
      await gitService.unstashChanges(stashRef, drop);
      messageRouter.broadcastEvent("commitStateChanged", {});
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  // Modal confirmation before deleting a stash entry.
  messageRouter.handle(
    "deleteStash",
    requireGitOrThrow(ctx, async (gitService, params) => {
      const stashRef = params.stashRef as string;
      const deleteBtn = vscode.l10n.t("Delete");
      // SHA 全长 40 位，弹窗展示用短哈希即可。
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Delete stashed changes "{0}"? This cannot be undone.',
          stashRef.slice(0, 8),
        ),
        { modal: true },
        deleteBtn,
      );
      if (choice !== deleteBtn) return { success: false };
      await gitService.deleteStash(stashRef);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "showStashFileDiff",
    requireGitOrThrow(ctx, async (gitService, params) => {
      const stashRef = params.stashRef as string;
      const filePath = params.filePath as string;

      const repoQuery = `&repo=${encodeURIComponent(gitService.cwd)}`;
      // path 逐段编码（"/" 保留），与 GitContentProvider 内的 decode 对称，
      // 含空格/中文/% 等特殊字符的路径才能正确往返。
      const encodedPath = encodeGitAtlasPath(filePath);
      const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
      // Show diff between the stash version and the parent (before stash)
      const stashUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${encodedPath}?ref=${stashRef}${repoQuery}`,
      );
      const parentUri = vscode.Uri.parse(
        `${GIT_ATLAS_SCHEME}:/${encodedPath}?ref=${stashRef}^${repoQuery}`,
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        parentUri,
        stashUri,
        `${fileName} (Stashed: ${stashRef.slice(0, 8)})`,
      );
      return { success: true };
    }),
  );

  messageRouter.handle(
    "unstashFile",
    requireGitOrThrow(ctx, async (gitService, params) => {
      const stashRef = params.stashRef as string;
      const filePath = params.filePath as string;

      // 覆盖确认：目标文件当前有未提交改动时，checkout 会静默覆盖工作区
      // 内容，先弹 modal 确认（与 rollbackHandlers 一致），拒绝则中止。
      if (await gitService.hasUncommittedFileChanges(filePath)) {
        const confirmBtn = vscode.l10n.t("Overwrite");
        const choice = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Unstashing will overwrite uncommitted changes to "{0}". Continue?',
            filePath,
          ),
          { modal: true },
          confirmBtn,
        );
        if (choice !== confirmBtn) return { success: false };
      }

      // Checkout the single file from the stash into the working tree.
      // 走 stash 专用检出：未跟踪文件存在 stash 的第三父提交（^3）中，
      // 直接 checkout <sha> 会报 pathspec did not match。
      // 让错误自然冒泡到 webview（统一协议），不要走 vscode.window.showErrorMessage
      // 原生通知 — 那样 webview 端无法感知错误。
      await gitService.checkoutFileFromStash(stashRef, filePath);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );
}
