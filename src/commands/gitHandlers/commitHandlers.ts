import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";
import { ErrorCode } from "../../messages/protocol";

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
        await gitService.commitAndPush(message, amend ?? false);
        messageRouter.broadcastEvent("commitStateChanged", {});
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
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
      if (!hash || !/^[0-9a-f]{40}$/i.test(hash)) {
        return {
          success: false,
          error: { code: ErrorCode.INVALID_REF, message: "Invalid commit hash" },
        };
      }

      // Check if merge commit (reject before emitting operationStart)
      const parents = await gitService.getCommitParents(hash);
      if (parents.length > 1) {
        return {
          success: false,
          error: {
            code: ErrorCode.GIT_COMMAND_FAILED,
            message: "Merge commits cannot be dropped",
          },
        };
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
}
