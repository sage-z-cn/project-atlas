import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";

/**
 * Push / pull / fetch handlers plus push-panel orchestration.
 *
 * Extracted from reference project extension.ts. Network-touching handlers are
 * wrapped in withProgress so the webview shows a spinner. executePush returns
 * the raw git output so the push panel can surface an "up-to-date" toast
 * before closing.
 */
export function registerRemoteHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "pushBranch",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      const force = params.force as boolean | undefined;
      return withProgress(ctx, async () => {
        await gitService.push(branchName, force ?? false);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "pullBranch",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string | undefined;
      return withProgress(ctx, async () => {
        await gitService.pull(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "pullRebase",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string | undefined;
      return withProgress(ctx, async () => {
        await gitService.pullRebase(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "pullMerge",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string | undefined;
      return withProgress(ctx, async () => {
        await gitService.pull(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "fetchBranch",
    requireGit(ctx, async (gitService) => {
      return withProgress(ctx, async () => {
        await gitService.fetch();
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "fetchAll",
    requireGit(ctx, async (gitService) => {
      return withProgress(ctx, async () => {
        await gitService.fetch();
        gitService.invalidateCache();
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "executePush",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      const force = params.force as boolean | undefined;
      const remote = (params.remote as string) || "origin";
      const targetBranch = (params.targetBranch as string) || branchName;
      return withProgress(ctx, async () => {
        const output = await gitService.push(
          branchName,
          force ?? false,
          remote,
          targetBranch,
        );
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        messageRouter.broadcastEvent("commitStateChanged", {});
        // Return push output so webview can show result toast before closing
        const isUpToDate =
          output?.includes("Everything up-to-date") ||
          output?.includes("up to date");
        return { success: true, data: { output: output ?? "", isUpToDate } };
      });
    }),
  );

  messageRouter.handle(
    "openPushPanel",
    requireGit(ctx, async (gitService) => {
      const branch = await gitService.getCurrentBranch();
      if (!branch) return { error: "No current branch" };
      const remote = await gitService.getDefaultRemote(branch);
      ctx.pushPanel.open(branch, remote);
      return { success: true };
    }),
  );

  messageRouter.handle("closePushPanel", async () => {
    ctx.pushPanel.close();
    return { success: true };
  });
}
