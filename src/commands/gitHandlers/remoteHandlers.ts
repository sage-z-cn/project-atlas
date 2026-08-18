import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";
import type { GitService } from "../../git/gitService";

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

  // Fire-and-forget background fetch after a remote config change. Deliberately
  // NOT awaited by the caller: fetch is a network op that can exceed the
  // webview bridge's 10s request timeout, so handlers return immediately and
  // the result surfaces later via gitStateChanged. Reuses gitService.fetch()
  // (which runs `git fetch <remote>` and invalidates the whole cache itself),
  // so on success we only broadcast; failures are logged, never propagated,
  // and the .catch keeps the floating promise from rejecting unhandled.
  const fetchRemoteInBackground = (
    gitService: GitService,
    remote: string,
  ): void => {
    gitService
      .fetch(remote)
      .then(() => {
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      })
      .catch((error) => {
        console.error(
          `[Git Atlas] Background fetch of remote "${remote}" failed:`,
          error,
        );
      });
  };

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
      const remote = params.remote as string | undefined;
      const targetBranch = (params.targetBranch as string) || branchName;
      const withTags = params.withTags as boolean | undefined;
      return withProgress(ctx, async () => {
        const output = await gitService.push(
          branchName,
          force ?? false,
          remote,
          targetBranch,
          withTags ?? false,
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
    requireGit(ctx, async (gitService, params) => {
      // 优先使用前端显式传入的 branchName（如分支侧栏右键推送非当前分支）；
      // 缺失时回退到当前分支（commitAndPush 被拒、commit 面板"提交并推送"）。
      const explicitBranch = params.branchName as string | undefined;
      const branch = explicitBranch ?? (await gitService.getCurrentBranch());
      if (!branch) return { error: "No current branch" };
      const remote = await gitService.getDefaultRemote(branch);
      const withTags = params.withTags as boolean | undefined;
      // 当 skipPushConfirmation 流程下 push 被拒时，前端会附带 initialPushError
      // 调用本接口；PushPanel 启动后据此直接进入 rebase/merge 对话框。
      const initialPushError = params.initialPushError as string | undefined;
      ctx.pushPanel.open(branch, remote, withTags ?? false, initialPushError);
      return { success: true };
    }),
  );

  messageRouter.handle(
    "getRemoteUrl",
    requireGit(ctx, async (gitService, params) => {
      // Resolve the real remote name when none is provided, instead of
      // assuming "origin". getDefaultRemote() inspects upstream config and
      // the configured remote list.
      const remote =
        (params.remote as string) ||
        (await gitService.getDefaultRemote());
      const url = await gitService.getRemoteUrl(remote);
      return { success: true, url };
    }),
  );

  messageRouter.handle(
    "getRemotes",
    requireGit(ctx, async (gitService) => {
      const remotes = await gitService.getRemotes();
      return { remotes };
    }),
  );

  messageRouter.handle(
    "addRemote",
    requireGit(ctx, async (gitService, params) => {
      const name = ((params.name as string) || "").trim();
      const url = ((params.url as string) || "").trim();
      const shouldFetch = params.fetch as boolean | undefined;
      if (!name) throw new Error("Remote name is required.");
      if (/\s/.test(name)) throw new Error("Remote name must not contain whitespace.");
      if (!url) throw new Error("Remote URL is required.");
      await gitService.addRemote(name, url);
      // GitWatcher does not watch .git/config, so remote mutations must
      // invalidate cached branch data and notify webviews manually.
      gitService.cache.invalidate("branches:v2");
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      if (shouldFetch) fetchRemoteInBackground(gitService, name);
      return { success: true };
    }),
  );

  messageRouter.handle(
    "removeRemote",
    requireGit(ctx, async (gitService, params) => {
      const name = ((params.name as string) || "").trim();
      if (!name) throw new Error("Remote name is required.");
      await gitService.removeRemote(name);
      gitService.cache.invalidate("branches:v2");
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "setRemoteUrl",
    requireGit(ctx, async (gitService, params) => {
      const name = ((params.name as string) || "").trim();
      const url = ((params.url as string) || "").trim();
      const shouldFetch = params.fetch as boolean | undefined;
      if (!name) throw new Error("Remote name is required.");
      if (/\s/.test(name)) throw new Error("Remote name must not contain whitespace.");
      if (!url) throw new Error("Remote URL is required.");
      await gitService.setRemoteUrl(name, url);
      gitService.cache.invalidate("branches:v2");
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      if (shouldFetch) fetchRemoteInBackground(gitService, name);
      return { success: true };
    }),
  );

  messageRouter.handle(
    "renameRemote",
    requireGit(ctx, async (gitService, params) => {
      const name = ((params.name as string) || "").trim();
      const newName = ((params.newName as string) || "").trim();
      const shouldFetch = params.fetch as boolean | undefined;
      if (!name) throw new Error("Remote name is required.");
      if (/\s/.test(name)) throw new Error("Remote name must not contain whitespace.");
      if (!newName) throw new Error("New remote name is required.");
      if (/\s/.test(newName)) throw new Error("New remote name must not contain whitespace.");
      // `git remote rename` migrates branch.*.remote upstream config too —
      // a remove+add combo would silently drop it.
      await gitService.renameRemote(name, newName);
      gitService.cache.invalidate("branches:v2");
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      // Post-rename the remote answers to its new name.
      if (shouldFetch) fetchRemoteInBackground(gitService, newName);
      return { success: true };
    }),
  );

  messageRouter.handle(
    "pushTag",
    requireGit(ctx, async (gitService, params) => {
      const tagName = params.tagName as string;
      const remote = params.remote as string | undefined;
      return withProgress(ctx, async () => {
        await gitService.pushTag(tagName, remote);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle("closePushPanel", async () => {
    ctx.pushPanel.close();
    return { success: true };
  });
}
