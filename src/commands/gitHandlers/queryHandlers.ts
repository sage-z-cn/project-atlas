import { NOT_GIT_REPO, requireGit } from "../gitContext";
import type { GitHandlerContext } from "../gitContext";
import type { LaneSnapshot } from "../../git/types";
import { extToLanguage } from "../../utils/ideaPatch";

/**
 * Read-only / query handlers (log, graph, branches, tags, diff, status, etc.).
 *
 * Every handler that operates on the active repo is wrapped in requireGit so
 * the `if (!svc) return NOT_GIT_REPO;` guard is centralised.
 *
 * Handlers with non-standard fallbacks (getCherryPickState / getRebaseState)
 * or that need explicit repo routing without the requireGit shape
 * (getWorkingTreeChanges) are written by hand to preserve their exact
 * fallback behaviour.
 */
export function registerQueryHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "getGraphData",
    requireGit(ctx, async (gitService, params) => {
      const options = {
        maxCount: (params.maxCount as number) ?? 200,
        skip: params.skip as number | undefined,
        branch: params.branch as string | undefined,
        search: params.search as string | undefined,
        author: params.author as string | undefined,
        file: params.file as string | undefined,
      };
      const snapshot = params.snapshot as LaneSnapshot | undefined;
      return gitService.getGraphTopology(options, snapshot);
    }),
  );

  messageRouter.handle(
    "getLog",
    requireGit(ctx, async (gitService, params) => {
      return gitService.getLog(
        params as Record<string, unknown> & { maxCount?: number },
      );
    }),
  );

  messageRouter.handle(
    "loadMoreLog",
    requireGit(ctx, async (gitService, params) => {
      const options = {
        maxCount: (params.count as number) ?? 200,
        skip: (params.skip as number) ?? 0,
        branch: params.branch as string | undefined,
        search: params.search as string | undefined,
        author: params.author as string | undefined,
      };
      const snapshot = params.snapshot as LaneSnapshot | undefined;
      return gitService.getGraphTopology(options, snapshot);
    }),
  );

  messageRouter.handle(
    "getBranches",
    requireGit(ctx, async (gitService) => {
      return gitService.getBranches();
    }),
  );

  messageRouter.handle(
    "getRemoteBranches",
    requireGit(ctx, async (gitService) => {
      // Invalidate branch cache to reflect latest remote changes
      gitService.cache.invalidate("branches");
      return gitService.getRemoteBranches();
    }),
  );

  messageRouter.handle(
    "getTags",
    requireGit(ctx, async (gitService) => {
      return gitService.getTags();
    }),
  );

  messageRouter.handle(
    "getDiff",
    requireGit(ctx, async (gitService, params) => {
      const ref1 = params.ref1 as string;
      const ref2 = params.ref2 as string;
      const file = params.file as string | undefined;
      return gitService.getDiff(ref1, ref2, file);
    }),
  );

  messageRouter.handle(
    "getFileContent",
    requireGit(ctx, async (gitService, params) => {
      const ref = params.ref as string;
      const filePath = params.filePath as string;
      return gitService.getFileContent(ref, filePath);
    }),
  );

  messageRouter.handle(
    "getCommitFiles",
    requireGit(ctx, async (gitService, params) => {
      const hash = params.hash as string;
      return gitService.getCommitFiles(hash);
    }),
  );

  messageRouter.handle(
    "getCommitRangeFiles",
    requireGit(ctx, async (gitService, params) => {
      const hashes = params.hashes as string[];
      return gitService.getCommitRangeFiles(hashes);
    }),
  );

  messageRouter.handle(
    "getStatus",
    requireGit(ctx, async (gitService) => {
      return gitService.getStatus();
    }),
  );

  messageRouter.handle(
    "getMergeState",
    requireGit(ctx, async (gitService) => {
      return gitService.getMergeState();
    }),
  );

  // Note: returns { isCherryPicking: false } when no gitService, not NOT_GIT_REPO.
  messageRouter.handle("getCherryPickState", async () => {
    if (!ctx.gitService) return { isCherryPicking: false };
    return ctx.gitService.getCherryPickState();
  });

  // Note: returns { isRebasing: false } when no gitService, not NOT_GIT_REPO.
  messageRouter.handle("getRebaseState", async () => {
    if (!ctx.gitService) return { isRebasing: false };
    return ctx.gitService.getRebaseState();
  });

  messageRouter.handle(
    "getConflictFiles",
    requireGit(ctx, async (gitService) => {
      return gitService.getConflictFiles();
    }),
  );

  messageRouter.handle(
    "getFileVersions",
    requireGit(ctx, async (gitService, params) => {
      const filePath = params.filePath as string;
      const versions = await gitService.getFileVersions(filePath);
      const mergeState = await gitService.getMergeState();
      const ext = filePath.split(".").pop() ?? "";
      return {
        ...versions,
        language: extToLanguage(ext),
        mergeMsg: mergeState.mergeMsg,
      };
    }),
  );

  messageRouter.handle(
    "getAheadCommits",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      const remote = params.remote as string | undefined;
      const commits = await gitService.getAheadCommits(branchName, remote);
      return { commits };
    }),
  );

  // Multi-repo (phase A): returns working-tree changes for the currently
  // selected repo only (or the repo named by params.repoPath). Previously
  // this aggregated across all workspace folders; the oracle review flagged
  // the aggregation as cross-contaminating unrelated repos and it has been
  // scoped down. Written by hand (not via requireGit) to preserve the
  // NOT_GIT_REPO fallback shape exactly.
  messageRouter.handle("getWorkingTreeChanges", async (params) => {
    const svc = params?.repoPath
      ? ctx.registry.getService(params.repoPath as string)
      : ctx.registry.getCurrent();
    if (!svc) return NOT_GIT_REPO;
    return svc.getWorkingTreeChanges();
  });

  messageRouter.handle(
    "getAmendMessage",
    requireGit(ctx, async (gitService) => {
      const message = await gitService.getLastCommitMessage();
      return { message };
    }),
  );

  messageRouter.handle(
    "getRecentCommitMessages",
    requireGit(ctx, async (gitService) => {
      return gitService.getRecentCommitMessages(20);
    }),
  );

  messageRouter.handle(
    "getShelves",
    requireGit(ctx, async (gitService) => {
      return gitService.getShelves();
    }),
  );

  messageRouter.handle(
    "getIdeaShelves",
    requireGit(ctx, async (gitService) => {
      return gitService.getIdeaShelves();
    }),
  );
}
