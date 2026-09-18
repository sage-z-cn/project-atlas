import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";

/**
 * Branch operation handlers (checkout / create / delete / rename / compare).
 *
 * Extracted from reference project extension.ts. Mutation handlers broadcast
 * gitStateChanged after the operation completes. Long-running operations keep
 * their withProgress wrapper so the webview can show a progress indicator.
 */
export function registerBranchHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  messageRouter.handle(
    "checkoutBranch",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      return withProgress(ctx, async () => {
        await gitService.checkout(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  messageRouter.handle(
    "createBranch",
    requireGit(ctx, async (gitService, params) => {
      const newBranchName = params.newBranchName as string;
      const startPoint = params.startPoint as string;
      const checkout = params.checkout as boolean | undefined;
      const force = params.force as boolean | undefined;
      await gitService.createBranch(newBranchName, startPoint, force ?? false);
      if (checkout) {
        await gitService.checkout(newBranchName);
      }
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "deleteBranch",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      const isRemote = params.isRemote as boolean;
      const force = params.force as boolean | undefined;
      if (isRemote) {
        await gitService.deleteRemoteBranch(branchName);
      } else {
        await gitService.deleteBranch(branchName, force ?? false);
      }
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "renameBranch",
    requireGit(ctx, async (gitService, params) => {
      const oldName = params.oldName as string;
      const newName = params.newName as string;
      await gitService.renameBranch(oldName, newName);
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  /**
   * Set upstream tracking. Incomplete pairs open a QuickPick on the host:
   * - only branchName → pick a remote-tracking branch
   * - only remoteBranch → pick a local branch
   * - both → apply directly
   */
  messageRouter.handle(
    "setBranchUpstream",
    requireGit(ctx, async (gitService, params) => {
      let branchName = params.branchName as string | undefined;
      let remoteBranch = params.remoteBranch as string | undefined;

      if (!branchName && !remoteBranch) {
        return {
          success: false,
          error: vscode.l10n.t("Branch name is required"),
        };
      }

      if (branchName && !remoteBranch) {
        const groups = await gitService.getRemoteBranches();
        const all = groups.flatMap((g) =>
          g.branches.map((b) => `${g.remote}/${b}`),
        );
        if (all.length === 0) {
          void vscode.window.showWarningMessage(
            vscode.l10n.t("No remote branches available"),
          );
          return {
            success: false,
            error: vscode.l10n.t("No remote branches available"),
          };
        }
        // Prefer a remote branch whose short name matches the local branch.
        const preferred = all.find((r) => {
          const slash = r.indexOf("/");
          return slash !== -1 && r.substring(slash + 1) === branchName;
        });
        const ordered = preferred
          ? [preferred, ...all.filter((r) => r !== preferred)]
          : all;
        const picked = await vscode.window.showQuickPick(ordered, {
          placeHolder: vscode.l10n.t(
            "Select upstream for '{0}'",
            branchName,
          ),
        });
        if (!picked) return { success: false, cancelled: true };
        remoteBranch = picked;
      } else if (!branchName && remoteBranch) {
        const branches = await gitService.getBranches();
        const locals = branches
          .filter((b) => !b.isRemote && !b.name.startsWith("("))
          .map((b) => b.name)
          .sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" }),
          );
        if (locals.length === 0) {
          void vscode.window.showWarningMessage(
            vscode.l10n.t("No local branches available"),
          );
          return {
            success: false,
            error: vscode.l10n.t("No local branches available"),
          };
        }
        const remoteShort = remoteBranch.includes("/")
          ? remoteBranch.substring(remoteBranch.indexOf("/") + 1)
          : remoteBranch;
        const preferredLocal = locals.find((n) => n === remoteShort);
        const ordered = preferredLocal
          ? [
              preferredLocal,
              ...locals.filter((n) => n !== preferredLocal),
            ]
          : locals;
        const picked = await vscode.window.showQuickPick(ordered, {
          placeHolder: vscode.l10n.t(
            "Select local branch to track '{0}'",
            remoteBranch,
          ),
        });
        if (!picked) return { success: false, cancelled: true };
        branchName = picked;
      }

      return withProgress(ctx, async () => {
        await gitService.setUpstream(branchName!, remoteBranch!);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        void vscode.window.showInformationMessage(
          vscode.l10n.t(
            "Branch '{0}' now tracks '{1}'",
            branchName!,
            remoteBranch!,
          ),
        );
        return {
          success: true,
          branchName,
          upstream: remoteBranch,
        };
      });
    }),
  );

  messageRouter.handle(
    "unsetBranchUpstream",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      if (!branchName) {
        return {
          success: false,
          error: vscode.l10n.t("Branch name is required"),
        };
      }
      return withProgress(ctx, async () => {
        await gitService.unsetUpstream(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        void vscode.window.showInformationMessage(
          vscode.l10n.t("Upstream unset for '{0}'", branchName),
        );
        return { success: true, branchName };
      });
    }),
  );

  messageRouter.handle(
    "createBranchFromCommit",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      const hash = params.hash as string;
      const checkout = params.checkout as boolean | undefined;
      const force = params.force as boolean | undefined;
      await gitService.createBranchFromCommit(branchName, hash, force ?? false);
      if (checkout) {
        await gitService.checkout(branchName);
      }
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { success: true };
    }),
  );

  messageRouter.handle(
    "createBranchPrompt",
    requireGit(ctx, async (gitService, params) => {
      const name = params.branchName as string | undefined;
      const checkout = params.checkout as boolean | undefined;
      const force = params.force as boolean | undefined;
      if (!name) return { success: false };
      return withProgress(ctx, async () => {
        await gitService.createBranch(name, "HEAD", force ?? false);
        if (checkout) {
          await gitService.checkout(name);
        }
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

  // Modal confirmation: prompts the user before deleting the branch.
  messageRouter.handle(
    "deleteBranchPrompt",
    requireGit(ctx, async (gitService, params) => {
      const branchName = params.branchName as string;
      if (!branchName) return { success: false };
      const confirm = await vscode.window.showWarningMessage(
        `Delete branch "${branchName}"?`,
        { modal: true },
        "Delete",
      );
      if (confirm !== "Delete") return { success: false };
      return withProgress(ctx, async () => {
        await gitService.deleteBranch(branchName);
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
        return { success: true };
      });
    }),
  );

}
