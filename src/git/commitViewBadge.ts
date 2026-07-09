import * as vscode from "vscode";
import type { GitService } from "./gitService";
import type { RepoRegistry } from "./repoRegistry";

/**
 * Activity-bar badge for the Git Commit view.
 *
 * The commit panel is a `webview` view, and VSCode only renders a
 * `WebviewView.badge` after the user has opened that view at least once
 * (issues #146330, #164974). To show a change-count badge on the activity
 * bar icon from the moment the workspace opens, we register a hidden TreeView
 * (`"when": "false"` in package.json) whose `badge` property draws the number
 * onto the container's activity-bar icon. This is the officially recommended
 * workaround (vscode-discussions #955).
 *
 * Behaviour is driven by `gitAtlas.commitBadgeMode`:
 *  - `total`   — sum of working-tree changes across all repositories
 *                (single-repo workspaces behave identically to `current`)
 *  - `current` — changes in the currently selected repository
 *  - `off`     — no badge
 */
const VIEW_ID = "git-atlas.commitBadgeProxy";
const CONFIG_KEY = "gitAtlas.commitBadgeMode";

type BadgeMode = "total" | "current" | "off";

function readMode(): BadgeMode {
  const raw = vscode.workspace
    .getConfiguration("gitAtlas")
    .get<string>("commitBadgeMode", "current");
  return raw === "total" || raw === "current" || raw === "off"
    ? raw
    : "current";
}

// The proxy view is never rendered ("when": "false"), so this provider is a
// no-op stub that only exists to satisfy createTreeView's signature.
const emptyProvider: vscode.TreeDataProvider<vscode.TreeItem> = {
  getTreeItem: (element: vscode.TreeItem) => element,
  getChildren: () => [],
};

export function registerCommitViewBadge(
  registry: RepoRegistry,
): vscode.Disposable {
  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: emptyProvider,
    showCollapseAll: false,
  });

  // Debounce consecutive git-state events into a single refresh, and avoid
  // reentrant refreshes — mirrors registerGitStatusBar in setupGit.ts.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshing = false;
  let pendingRefresh = false;

  const scheduleRefresh = (): void => {
    if (refreshing) {
      pendingRefresh = true;
      return;
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshBadge();
    }, 200);
  };

  async function countChanges(svc: GitService): Promise<number> {
    try {
      return (await svc.getWorkingTreeChanges()).length;
    } catch {
      return 0;
    }
  }

  async function computeCount(): Promise<{
    count: number;
    aggregated: boolean;
  }> {
    const mode = readMode();
    if (mode === "off") return { count: 0, aggregated: false };

    const multiRepo = registry.getRepoInfos().length > 1;

    // `current`, or `total` in a single-repo workspace (the two collapse).
    if (mode === "current" || !multiRepo) {
      const svc = registry.getCurrent();
      if (!svc) return { count: 0, aggregated: false };
      return { count: await countChanges(svc), aggregated: false };
    }

    // `total` in a multi-repo workspace: sum across every repo.
    let sum = 0;
    await Promise.all(
      registry.getAll().map(async (svc) => {
        sum += await countChanges(svc);
      }),
    );
    return { count: sum, aggregated: true };
  }

  async function refreshBadge(): Promise<void> {
    refreshing = true;
    try {
      const { count, aggregated } = await computeCount();
      // NEVER assign `undefined` — throws TypeError on some VSCode versions
      // (issues #162900, #210640). Clear the badge via value:0 instead.
      if (count <= 0) {
        treeView.badge = { value: 0, tooltip: "" };
        return;
      }
      const tooltip = aggregated
        ? vscode.l10n.t("{0} changes across all repositories", count)
        : vscode.l10n.t("{0} changes", count);
      treeView.badge = { value: count, tooltip };
    } finally {
      refreshing = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        scheduleRefresh();
      }
    }
  }

  const subscriptions: vscode.Disposable[] = [
    registry.onGitStateChanged(scheduleRefresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_KEY)) scheduleRefresh();
    }),
  ];

  // Initial render once repos are populated.
  scheduleRefresh();

  return vscode.Disposable.from(treeView, ...subscriptions);
}
