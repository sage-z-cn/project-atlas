import * as vscode from "vscode";
import { normalizePath } from "./repoPaths";
import type { RepoRegistry } from "./repoRegistry";

/**
 * Bridge the built-in git extension's repository state into Git Atlas'
 * refresh pipeline (cache invalidation + gitStateChanged broadcast).
 *
 * Why this exists: GitWatcher's .git FileSystemWatcher can miss external git
 * writes (refs are updated via lockfile + atomic rename, which VSCode FS
 * watchers under-report on Windows), and the window-focus broadcast never
 * fires when the commit happens from VSCode's integrated terminal or from an
 * AI agent running git child processes — the window stays focused the whole
 * time. The built-in git extension depends on neither: it sniffs terminal git
 * commands (shell integration) and refreshes repository state from any git
 * child process — the same mechanism that keeps the SCM view current.
 * Mirroring repository.state.onDidChange through
 * RepoRegistry.notifyExternalGitChange() plugs our refresh pipeline into that
 * coverage.
 *
 * Best-effort supplement: when the built-in git extension is disabled or its
 * API shape is unexpected, the bridge no-ops and the existing watchers keep
 * working unchanged. Double-firing alongside GitWatcher for the same change
 * is harmless — webview refreshes are idempotent (seq-guarded fetches).
 */

const BUILTIN_GIT_EXTENSION_ID = "vscode.git";

/** Minimal structural subset of the built-in git extension's API we use. */
interface BuiltinGitRepositoryLike {
  rootUri: vscode.Uri;
  state: {
    onDidChange(listener: () => void): vscode.Disposable;
  };
}

interface BuiltinGitAPIv1Like {
  repositories: readonly BuiltinGitRepositoryLike[];
  onDidOpenRepository(
    listener: (repo: BuiltinGitRepositoryLike) => void,
  ): vscode.Disposable;
  onDidCloseRepository(
    listener: (repo: BuiltinGitRepositoryLike) => void,
  ): vscode.Disposable;
}

type BuiltinGitExports = {
  getAPI?: (version: number) => BuiltinGitAPIv1Like | undefined;
};

/** Per-repo debounce, mirrors GitWatcher's 300ms notify debounce. */
const DEBOUNCE_MS = 300;

export function setupBuiltinGitBridge(
  registry: RepoRegistry,
): vscode.Disposable {
  const apiSubs: vscode.Disposable[] = [];
  // Path key → subscriptions for that builtin repository's state changes.
  const repoSubs = new Map<string, vscode.Disposable[]>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;

  const notify = (repoPath: string): void => {
    const existing = debounceTimers.get(repoPath);
    if (existing) {
      clearTimeout(existing);
    }
    debounceTimers.set(
      repoPath,
      setTimeout(() => {
        debounceTimers.delete(repoPath);
        // Unknown repos (not tracked by our registry, e.g. a parent folder
        // the builtin git extension opened) are ignored inside.
        registry.notifyExternalGitChange(repoPath);
      }, DEBOUNCE_MS),
    );
  };

  const watchRepository = (repo: BuiltinGitRepositoryLike): void => {
    const key = normalizePath(repo.rootUri.fsPath);
    if (repoSubs.has(key)) {
      return;
    }
    repoSubs.set(key, [repo.state.onDidChange(() => notify(key))]);
  };

  const unwatchRepository = (repo: BuiltinGitRepositoryLike): void => {
    const key = normalizePath(repo.rootUri.fsPath);
    const subs = repoSubs.get(key);
    if (!subs) {
      return;
    }
    for (const d of subs) {
      d.dispose();
    }
    repoSubs.delete(key);
    const timer = debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(key);
    }
  };

  const attach = (api: BuiltinGitAPIv1Like): void => {
    // The builtin git extension discovers repositories asynchronously — the
    // initial list may be incomplete, so also follow open/close events.
    for (const repo of api.repositories) {
      watchRepository(repo);
    }
    apiSubs.push(
      api.onDidOpenRepository(watchRepository),
      api.onDidCloseRepository(unwatchRepository),
    );
  };

  const ext = vscode.extensions.getExtension(BUILTIN_GIT_EXTENSION_ID);
  if (ext) {
    // activate() returns PromiseLike (not Promise) — wrap for .catch access.
    Promise.resolve(ext.activate())
      .then(() => {
        if (disposed) {
          return;
        }
        const exports = ext.exports as BuiltinGitExports | undefined;
        const api = exports?.getAPI?.(1);
        if (api) {
          attach(api);
        }
      })
      .catch((err) => {
        console.error(
          "[Git Atlas] builtin git bridge: activate failed:",
          err instanceof Error ? err.message : err,
        );
      });
  }

  return {
    dispose: () => {
      disposed = true;
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      for (const subs of repoSubs.values()) {
        for (const d of subs) {
          d.dispose();
        }
      }
      repoSubs.clear();
      for (const d of apiSubs) {
        d.dispose();
      }
      apiSubs.length = 0;
    },
  };
}
