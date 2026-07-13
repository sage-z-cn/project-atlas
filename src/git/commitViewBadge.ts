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
const ENABLE_KEY = "gitAtlas.enableCommitPanel";

type BadgeMode = "total" | "current" | "off";

function readMode(): BadgeMode {
  const raw = vscode.workspace
    .getConfiguration("gitAtlas")
    .get<string>("commitBadgeMode", "current");
  return raw === "total" || raw === "current" || raw === "off"
    ? raw
    : "current";
}

function readEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("gitAtlas")
    .get<boolean>("enableCommitPanel", true);
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
    failedRepos?: string[];
  }> {
    // Commit 面板已关闭时跳过所有计算：容器已隐藏，徽标无意义，且避免
    // 在多 repo + total 模式下遍历所有仓库的工作树（可能较重）。
    if (!readEnabled()) return { count: 0, aggregated: false };

    const mode = readMode();
    if (mode === "off") return { count: 0, aggregated: false };

    const multiRepo = registry.getRepoInfos().length > 1;

    // `current`, or `total` in a single-repo workspace (the two collapse).
    if (mode === "current" || !multiRepo) {
      const svc = registry.getCurrent();
      if (!svc) return { count: 0, aggregated: false };
      return { count: await countChanges(svc), aggregated: false };
    }

    // `total` in a multi-repo workspace: sum across every repo. MUST iterate
    // getAll() (services Map values) directly — never getService(path), which
    // re-normalizes the path and can silently miss entries when the double
    // normalize produces a different key, dropping repos from the total.
    // Per-repo failures are surfaced via tooltip instead of being swallowed.
    const allSvcs = registry.getAll();
    const names = registry.getRepoInfos().map((i) => i.name);
    let sum = 0;
    const failedRepos: string[] = [];
    await Promise.all(
      allSvcs.map(async (svc, idx) => {
        try {
          sum += (await svc.getWorkingTreeChanges()).length;
        } catch (err) {
          const name = names[idx] ?? `repo${idx}`;
          failedRepos.push(name);
          console.warn(
            `[commitViewBadge] getWorkingTreeChanges failed for ${name}:`,
            err,
          );
        }
      }),
    );
    return { count: sum, aggregated: true, failedRepos };
  }

  async function refreshBadge(): Promise<void> {
    refreshing = true;
    try {
      const { count, aggregated, failedRepos } = await computeCount();
      // NEVER assign `undefined` — throws TypeError on some VSCode versions
      // (issues #162900, #210640). Clear the badge via value:0 instead.
      if (count <= 0) {
        treeView.badge = { value: 0, tooltip: "" };
        return;
      }
      const tooltip = aggregated
        ? failedRepos && failedRepos.length > 0
          ? vscode.l10n.t(
              "{0} changes across all repositories ({1} unavailable)",
              count,
              failedRepos.length,
            )
          : vscode.l10n.t("{0} changes across all repositories", count)
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
      if (
        e.affectsConfiguration(CONFIG_KEY) ||
        e.affectsConfiguration(ENABLE_KEY)
      ) {
        scheduleRefresh();
      }
    }),
  ];

  // Initial render once repos are populated.
  scheduleRefresh();

  return vscode.Disposable.from(treeView, ...subscriptions);
}
