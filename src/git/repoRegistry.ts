import * as path from "node:path";
import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import { GitService } from "./gitService";
import { GitWatcher } from "../watchers/gitWatcher";
import { normalizePath } from "./repoPaths";
import type { RepoInfo } from "./repoScanner";
import { scanRepos } from "./repoScanner";

/**
 * Workspace-state key under which the user's last-selected repo path is
 * persisted between sessions.
 */
const CURRENT_REPO_KEY = "gitAtlas.currentRepoPath";

/**
 * Owns one GitService + one GitWatcher per discovered repository and tracks
 * which repo is currently "active" (the one panel / commit / diff editors
 * operate against).
 *
 * Multi-repo hard constraints enforced here (see oracle review):
 *
 *   1. Path normalization — every ingress path (scanner insertion, getService
 *      lookup, setCurrent query, persisted-state restore) flows through
 *      `normalizePath` before touching the internal Map. Without this,
 *      Windows drive-letter casing or separator variants would cause
 *      getService to silently miss and fall back to the wrong repo.
 *
 *   2. Persisted-state validation — the saved currentRepoPath is re-validated
 *      against the live services map on init; a stale value (repo deleted,
 *      different branch checked out, etc.) falls back to the first repo
 *      instead of producing a dangling currentRepo.
 *
 * In-flight race handling (concurrent GitService operations during a switch)
 * is intentionally NOT addressed here — it belongs to the store layer in a
 * later phase.
 */
export class RepoRegistry implements vscode.Disposable {
  private services = new Map<string, GitService>();
  private watchers = new Map<string, GitWatcher>();
  private currentRepoPath: string | null = null;
  private repoInfos: RepoInfo[] = [];

  constructor(
    private readonly messageRouter: MessageRouter,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Initial population: scan once, then restore the persisted current repo
   * (validated against the live service map, falling back to the first repo).
   */
  async init(workspaceRoots: string[]): Promise<void> {
    await this.rescan(workspaceRoots);

    const saved = this.context.workspaceState.get<string>(CURRENT_REPO_KEY);
    if (saved && this.services.has(normalizePath(saved))) {
      this.currentRepoPath = normalizePath(saved);
    } else {
      this.currentRepoPath = this.repoInfos[0]?.path ?? null;
    }
  }

  /**
   * Re-scan workspace roots and reconcile the service/watcher maps.
   *
   * Repos that disappeared are disposed and removed; repos that appeared get
   * a fresh GitService + GitWatcher. If the currently-selected repo is no
   * longer present, it falls back to the first available repo (or null).
   *
   * Safe to call repeatedly (e.g. on workspace folder changes in a later
   * phase) — only the delta is created/destroyed.
   */
  async rescan(workspaceRoots: string[]): Promise<void> {
    const infos = await scanRepos(workspaceRoots);
    const newPaths = new Set(infos.map((i) => i.path));

    // Tear down services/watchers for repos that are gone.
    for (const [p, w] of this.watchers) {
      if (!newPaths.has(p)) {
        w.dispose();
        this.watchers.delete(p);
        this.services.delete(p);
      }
    }

    // Spin up services/watchers for repos that are new.
    for (const info of infos) {
      if (!this.services.has(info.path)) {
        const svc = new GitService(info.path);
        const watcher = new GitWatcher(info.path, this.messageRouter, svc.cache);
        this.services.set(info.path, svc);
        this.watchers.set(info.path, watcher);
      }
    }

    this.repoInfos = infos;

    // currentRepo validation: fall back if it vanished.
    if (this.currentRepoPath && !newPaths.has(this.currentRepoPath)) {
      this.currentRepoPath = infos[0]?.path ?? null;
    }
  }

  /**
   * Resolve a GitService by raw path.
   *
   * `repoPath` is normalized at the ingress (hard constraint #1) so callers
   * can pass any casing/separator variant they happen to hold. Falls back to
   * the current repo when no path is supplied.
   */
  getService(repoPath?: string): GitService | null {
    if (!repoPath) return this.getCurrent();
    const normalized = normalizePath(repoPath);
    return this.services.get(normalized) ?? null;
  }

  /** The currently-selected repo's GitService, or null when none available. */
  getCurrent(): GitService | null {
    return this.currentRepoPath
      ? (this.services.get(this.currentRepoPath) ?? null)
      : null;
  }

  /** Normalized path of the currently-selected repo, or null. */
  getCurrentRepoPath(): string | null {
    return this.currentRepoPath;
  }

  /** All known GitServices (no ordering guarantee beyond insertion order). */
  getAll(): GitService[] {
    return [...this.services.values()];
  }

  /** Snapshot of RepoInfo describing every known repo (for getRepos handler). */
  getRepoInfos(): RepoInfo[] {
    return this.repoInfos;
  }

  /**
   * Find the repo whose working tree contains `filePath` (longest-prefix wins
   * to handle nested repos). Returns null when the path is outside every known
   * repo. Used by commands operating on an arbitrary file URI (e.g.
   * showFileHistory) to resolve the owning repo instead of blindly using the
   * currently-selected one.
   */
  findRepoForPath(filePath: string): RepoInfo | null {
    const normalized = normalizePath(filePath);
    let best: RepoInfo | null = null;
    for (const info of this.repoInfos) {
      const repoPath = info.path;
      if (
        normalized === repoPath ||
        normalized.startsWith(repoPath + path.sep)
      ) {
        if (!best || repoPath.length > best.path.length) {
          best = info;
        }
      }
    }
    return best;
  }

  /**
   * Select the active repo. The path is normalized (hard constraint #1) and
   * rejected silently if it isn't a known repo. On success the choice is
   * persisted to workspaceState and a `repoChanged` event is broadcast so
   * panel/commit webviews can refetch.
   */
  async setCurrent(repoPath: string): Promise<void> {
    const normalized = normalizePath(repoPath);
    if (!this.services.has(normalized)) return;
    this.currentRepoPath = normalized;
    await this.context.workspaceState.update(CURRENT_REPO_KEY, normalized);
    this.messageRouter.broadcastEvent("repoChanged", { repoPath: normalized });
  }

  dispose(): void {
    for (const w of this.watchers.values()) w.dispose();
    this.watchers.clear();
    this.services.clear();
  }
}
