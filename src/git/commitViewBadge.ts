import * as vscode from "vscode";
import type { RepoRegistry } from "./repoRegistry";
import { logger } from "../utils/logger";

/**
 * Activity-bar badge for the Git Commit view (with diagnostic logging).
 *
 * The commit panel is a `webview` view, and VSCode only renders a
 * `WebviewView.badge` after the user has opened that view at least once
 * (issues #146330, #164974). To show a change-count badge on the activity
 * bar icon from the moment the workspace opens, we register a hidden TreeView
 * (`"when": "false"` in package.json) whose `badge` property draws the number
 * onto the container's activity-bar icon. This is the officially recommended
 * workaround (vscode-discussions #955).
 *
 * Behaviour is driven by `gitAtlas.commitBadgeMode` (default `total`):
 *  - `total`   — sum of working-tree changes across every repository.
 *  - `current` — changes in the currently selected repository only.
 *  - `off`     — no badge.
 *
 * Repo/service alignment contract:
 *   Iterate `registry.getRepoInfos()` (authoritative, scan-ordered) and resolve
 *   each service via `registry.getService(info.path)` so name/service/path
 *   stay one-to-one. NEVER iterate `registry.getAll()` beside a separate names
 *   array — the services Map mutates incrementally during rescan and its
 *   iteration order diverges from the scan order, desyncing the two.
 *
 * ── Diagnostic logging ────────────────────────────────────────────────
 * Every refresh writes a structured snapshot to the shared "Project Atlas"
 * output channel (via the global {@link logger}): trigger source, mode, repo
 * count, per-repo service resolution + change count, the computed sum, and
 * the badge value actually assigned. Open the channel via the Output panel to
 * inspect why a multi-repo total is (mis)counting. This is intentional
 * instrumentation, not debug leftovers.
 */
const VIEW_ID = "git-atlas.commitBadgeProxy";
const CONFIG_KEY = "gitAtlas.commitBadgeMode";
const ENABLE_KEY = "gitAtlas.enableCommitPanel";

type BadgeMode = "total" | "current" | "off";

function readMode(): BadgeMode {
  const raw = vscode.workspace
    .getConfiguration("gitAtlas")
    .get<string>("commitBadgeMode", "total");
  return raw === "total" || raw === "current" || raw === "off" ? raw : "total";
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

interface BadgeResult {
  count: number;
  aggregated: boolean;
  failedRepos: string[];
}

interface RepoCount {
  name: string;
  path: string;
  status: "ok" | "missing" | "failed";
  count: number;
  error?: string;
}

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
  let lastSource = "initial";

  const scheduleRefresh = (source: string): void => {
    lastSource = source;
    if (refreshing) {
      pendingRefresh = true;
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshBadge();
    }, 200);
  };

  /**
   * Count one repo's working-tree changes. Resolves the service by normalized
   * path so name↔service can never desync (see alignment contract). Returns a
   * structured result the caller logs in scan order (concurrent fetch,
   * ordered reporting).
   */
  async function countRepo(
    name: string,
    repoPath: string,
  ): Promise<RepoCount> {
    const svc = registry.getService(repoPath);
    if (!svc) {
      return { name, path: repoPath, status: "missing", count: 0 };
    }
    try {
      const count = (await svc.getWorkingTreeChanges()).length;
      return { name, path: repoPath, status: "ok", count };
    } catch (err) {
      return {
        name,
        path: repoPath,
        status: "failed",
        count: 0,
        error: String(err).slice(0, 150),
      };
    }
  }

  async function computeBadge(): Promise<BadgeResult> {
    const enabled = readEnabled();
    const mode = readMode();
    const infos = registry.getRepoInfos();
    const allLen = registry.getAll().length;
    const currentPath = registry.getCurrentRepoPath();

    logger.section(
      `badge refresh · source=${lastSource} · ${new Date().toLocaleString()}`,
    );
    logger.log(
      `config: enabled=${enabled} mode=${mode}  repos(infos)=${infos.length}  services(map)=${allLen}  ${
        infos.length !== allLen ? "<< MISMATCH >>" : "consistent"
      }`,
    );
    logger.log(
      `currentRepoPath=${currentPath ?? "<none>"}  multiRepo=${infos.length > 1}`,
    );

    if (!enabled) {
      logger.log("=> count=0 (commit panel disabled — container hidden, skipped)");
      return { count: 0, aggregated: false, failedRepos: [] };
    }
    if (mode === "off") {
      logger.log("=> count=0 (mode=off)");
      return { count: 0, aggregated: false, failedRepos: [] };
    }

    // `current`, or `total` in a single-repo workspace (the two collapse).
    if (mode === "current" || infos.length <= 1) {
      const svc = registry.getCurrent();
      if (!svc) {
        logger.log("current: getCurrent()=NONE  => count=0");
        return { count: 0, aggregated: false, failedRepos: [] };
      }
      const r = await countRepo(
        infos.find((i) => i.path === currentPath)?.name ?? currentPath ?? "?",
        currentPath!,
      );
      logger.log(
        `current: [${r.name}] status=${r.status} count=${r.count}${
          r.error ? ` err=${r.error}` : ""
        }`,
      );
      return {
        count: r.status === "ok" ? r.count : 0,
        aggregated: false,
        failedRepos: r.status === "failed" ? [r.name] : [],
      };
    }

    // `total` across multiple repositories. Fetch concurrently, then report
    // in scan order so the log reads top-to-bottom per repo.
    logger.log(`total: iterating ${infos.length} repos (concurrent git status)...`);
    const results = await Promise.all(
      infos.map((info) => countRepo(info.name, info.path)),
    );

    let sum = 0;
    const failedRepos: string[] = [];
    for (const r of results) {
      if (r.status === "ok") {
        sum += r.count;
        logger.log(`  [${r.name}] status=ok        count=${r.count}`);
      } else if (r.status === "missing") {
        // getService(path) returned null — path normalization mismatch or the
        // repo vanished between getRepoInfos() and getService(). This repo is
        // SILENTLY DROPPED from the total. This is the prime suspect when the
        // total under-counts: log loudly so it cannot hide.
        logger.log(
          `  [${r.name}] status=MISSING    path=${r.path}  << dropped from total (getService returned null) >>`,
        );
      } else {
        failedRepos.push(r.name);
        logger.log(
          `  [${r.name}] status=FAILED     path=${r.path}  err=${r.error}  (counted as 0)`,
        );
      }
    }
    logger.log(
      `=> sum=${sum}  failedRepos=[${failedRepos.join(", ")}]  aggregated=true`,
    );
    return { count: sum, aggregated: true, failedRepos };
  }

  async function refreshBadge(): Promise<void> {
    refreshing = true;
    try {
      const { count, aggregated, failedRepos } = await computeBadge();
      // NEVER assign `undefined` — throws TypeError on some VSCode versions
      // (issues #162900, #210640). Clear the badge via value:0 instead.
      if (count <= 0) {
        treeView.badge = { value: 0, tooltip: "" };
        logger.log("badge := { value: 0 } (cleared)");
      } else {
        const tooltip = aggregated
          ? failedRepos.length > 0
            ? vscode.l10n.t(
                "{0} changes across all repositories ({1} unavailable)",
                count,
                failedRepos.length,
              )
            : vscode.l10n.t("{0} changes across all repositories", count)
          : vscode.l10n.t("{0} changes", count);
        treeView.badge = { value: count, tooltip };
        logger.log(`badge := { value: ${count}, tooltip="${tooltip.slice(0, 60)}" }`);
      }
      // Verify the assignment actually landed on the view.
      const after = treeView.badge;
      logger.log(
        `verify: treeView.badge.value=${after?.value ?? "<undefined>"}  visible=${treeView.visible}  title=${JSON.stringify(treeView.title)}`,
      );
    } catch (err) {
      logger.error(`refreshBadge threw: ${String(err).slice(0, 200)}`);
    } finally {
      refreshing = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        scheduleRefresh("reentrant");
      }
    }
  }

  const subscriptions: vscode.Disposable[] = [
    treeView,
    registry.onGitStateChanged(() => scheduleRefresh("gitState")),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(CONFIG_KEY) ||
        e.affectsConfiguration(ENABLE_KEY)
      ) {
        scheduleRefresh("config");
      }
    }),
  ];

  // Initial render once repos are populated.
  scheduleRefresh("initial");

  return vscode.Disposable.from(...subscriptions);
}
