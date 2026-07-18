import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";

/**
 * Commit / stage / reset / revert / tag handlers.
 *
 * Extracted from reference project extension.ts. Staging mutations broadcast
 * commitStateChanged; commit-class mutations broadcast both commitStateChanged
 * and gitStateChanged. dropCommit preserves its special validation prologue
 * (hash format + merge-commit rejection + 30s timeout) before entering
 * withProgress.
 */
export function registerCommitHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "stageFile",
    requireGit(ctx, async (gitService, params) => {
      await gitService.stageFile(params.filePath as string);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "unstageFile",
    requireGit(ctx, async (gitService, params) => {
      await gitService.unstageFile(params.filePath as string);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "stageAll",
    requireGit(ctx, async (gitService) => {
      await gitService.stageAll();
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "unstageAll",
    requireGit(ctx, async (gitService) => {
      await gitService.unstageAll();
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "stageFiles",
    requireGit(ctx, async (gitService, params) => {
      const filePaths = params.filePaths as string[];
      if (!filePaths || filePaths.length === 0) {
        return { success: false };
      }
      await gitService.stageFiles(filePaths);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "unstageFiles",
    requireGit(ctx, async (gitService, params) => {
      const filePaths = params.filePaths as string[];
      if (!filePaths || filePaths.length === 0) {
        return { success: false };
      }
      await gitService.unstageFiles(filePaths);
      messageRouter.broadcastEvent("commitStateChanged", {});
      return { success: true };
    }),
  );

  messageRouter.handle(
    "commitChanges",
    requireGit(ctx, async (gitService, params) => {
      const message = params.message as string;
      const amend = params.amend as boolean | undefined;
      const filePaths = params.filePaths as string[] | undefined;

      // Stage specified files if provided
      if (filePaths && filePaths.length > 0) {
        await gitService.stageFiles(filePaths);
      }

      await gitService.commit(message, amend ?? false);
      messageRouter.broadcastEvent("commitStateChanged", {});
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "commitAndPush",
    requireGit(ctx, async (gitService, params) => {
      const message = params.message as string;
      const amend = params.amend as boolean | undefined;
      const filePaths = params.filePaths as string[] | undefined;

      if (filePaths && filePaths.length > 0) {
        await gitService.stageFiles(filePaths);
      }

      return withProgress(ctx, async () => {
        // Commit first. A successful commit must persist (and refresh the
        // webview) even when the subsequent push is rejected, so broadcast
        // state changes here instead of after push.
        await gitService.commit(message, amend ?? false);
        messageRouter.broadcastEvent("commitStateChanged", {});
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });

        const branch = await gitService.getCurrentBranch();
        if (!branch) {
          return { success: true, pushed: false };
        }
        // Push is run separately so a rejected push does not roll back the
        // commit success; the push error is surfaced via `pushError`.
        try {
          await gitService.push(branch, amend ?? false);
          return { success: true, pushed: true };
        } catch (pushErr) {
          const pushError =
            pushErr instanceof Error ? pushErr.message : String(pushErr);
          return { success: true, pushed: false, pushError };
        }
      });
    }),
  );

  messageRouter.handle(
    "amendCommit",
    requireGit(ctx, async (gitService, params) => {
      const message = params.message as string;
      await gitService.commit(message, true);
      messageRouter.broadcastEvent("commitStateChanged", {});
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "checkoutCommit",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;
      await gitService.checkoutCommit(hash);
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "revertFileChanges",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;
      const filePath = params.filePath as string;
      const status = params.status as string | undefined;
      await gitService.checkoutFileFromParent(hash, filePath, status);
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "resetToCommit",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;
      const mode = params.mode as "soft" | "mixed" | "hard";
      return withProgress(ctx, async () => {
        await gitService.resetToCommit(hash, mode);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "revertCommit",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;
      return withProgress(ctx, async () => {
        await gitService.revertCommit(hash);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "dropCommit",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;

      // Validate hash format (40-char hex)
      // 校验失败必须 throw（而不是 return { success:false }），否则
      // MessageRouter 会包成 { success:true, data:{ success:false } }，
      // webview 端 CommitContextMenu.handleDropCommit 的 try-catch 拿不到。
      if (!hash || !/^[0-9a-f]{40}$/i.test(hash)) {
        throw new Error("Invalid commit hash");
      }

      // Check if merge commit (reject before emitting operationStart)
      const parents = await gitService.getCommitParents(hash);
      if (parents.length > 1) {
        throw new Error("Merge commits cannot be dropped");
      }

      // Proceed with progress and 30-second timeout
      return withProgress(ctx, async () => {
        const timeoutMs = 30_000;
        const dropPromise = gitService.dropCommit(hash);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Operation timed out")), timeoutMs),
        );

        await Promise.race([dropPromise, timeoutPromise]);

        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        messageRouter.broadcastEvent("commitStateChanged", {});
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "createTag",
    requireGit(ctx, async (gitService, params) => {
      const tagName = params.tagName as string;
      const hash = params.hash as string;
      const message = params.message as string | undefined;
      await gitService.createTag(tagName, hash, message);
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "deleteTag",
    requireGit(ctx, async (gitService, params) => {
      const tagName = params.tagName as string;
      await gitService.deleteTag(tagName);
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  // ── Commit message draft (project-level, multi-repo) ───────────────────
  // 缓存在 workspaceState（项目级，跨重载持久化），按 repoPath 分键，支持多 repo。
  // 空 message 时删除该 repo 的键，避免堆积空草稿。
  const DRAFT_KEY = "gitAtlas.commitDrafts";

  messageRouter.handle("getCommitDraft", async (params) => {
    const repoPath = (params?.repoPath as string) ?? "";
    if (!repoPath) {
      return { message: "" };
    }
    const drafts = ctx.context.workspaceState.get<Record<string, string>>(DRAFT_KEY, {});
    return { message: drafts[repoPath] ?? "" };
  });

  messageRouter.handle("saveCommitDraft", async (params) => {
    const repoPath = (params?.repoPath as string) ?? "";
    if (!repoPath) {
      return { success: false };
    }
    const message = (params?.message as string) ?? "";
    const drafts = ctx.context.workspaceState.get<Record<string, string>>(DRAFT_KEY, {});
    if (message.trim() === "") {
      delete drafts[repoPath];
    } else {
      drafts[repoPath] = message;
    }
    await ctx.context.workspaceState.update(DRAFT_KEY, drafts);
    return { success: true };
  });
}
