import * as nodefs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { normalizePath } from "./repoPaths";

/**
 * Minimal description of a git repository discovered under a workspace root.
 * `path` is always normalized via `normalizePath` so RepoRegistry keying is
 * stable across Windows drive-letter casing / separator variants.
 */
export interface RepoInfo {
  /** Normalized absolute path to the repository working directory. */
  path: string;
  /** Repository directory basename. */
  name: string;
  /**
   * Path relative to the owning workspace root.
   * `"."` for a repo sitting at the workspace root itself, otherwise the
   * direct child directory name (1-level scan only).
   */
  relativePath: string;
}

/**
 * Whether `dir` looks like a git working tree. Both a real `.git` directory
 * and the `.git` gitfile used by submodules count, so we only stat the path.
 * Any stat error (ENOENT, EACCES, EPERM, broken symlink) is treated as
 * "not a git repo" so a single unreadable entry never aborts the scan.
 */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await nodefs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Directory names that should never be treated as candidate sub-repos.
 * Dot-directories are filtered separately below.
 */
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Scan every workspace root for git repositories.
 *
 * For each root:
 *   1. If `<root>/.git` exists → register the root itself as a repo
 *      (relativePath `"."`).
 *   2. Read `<root>` direct children (1 level only — no recursion, to stay
 *      within the agreed scope and avoid perf cliffs on large workspaces).
 *      Each child directory that itself contains `.git` is registered as a
 *      sub-repo (relativePath = child name).
 *
 * Robustness:
 *   - A single unreadable root/child (permissions, broken symlink) is skipped
 *     via try/catch and never aborts the whole scan.
 *   - Duplicate normalized paths are deduplicated so an overlapping
 *     multi-root workspace cannot produce two services for one repo.
 *   - Output order: roots first (in input order), then children of each root
 *     in readdir order. RepoRegistry relies on `infos[0]` as a sane default
 *     fallback for currentRepoPath.
 */
export async function scanRepos(
  workspaceRoots: string[],
): Promise<RepoInfo[]> {
  const results: RepoInfo[] = [];
  const seen = new Set<string>();

  for (const root of workspaceRoots) {
    // 1. Root repo
    if (await isGitRepo(root)) {
      const normalized = normalizePath(root);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        results.push({
          path: normalized,
          name: path.basename(normalized),
          relativePath: ".",
        });
      }
    }

    // 2. Direct children (1 level)
    let entries: Dirent[];
    try {
      entries = await nodefs.readdir(root, { withFileTypes: true });
    } catch {
      // Unreadable root (permissions / missing) — skip its children scan.
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      // Skip dot-directories (e.g. .vscode, .cache) — not user repos.
      if (entry.name.startsWith(".")) continue;

      const childPath = path.join(root, entry.name);
      try {
        if (await isGitRepo(childPath)) {
          const normalized = normalizePath(childPath);
          if (!seen.has(normalized)) {
            seen.add(normalized);
            results.push({
              path: normalized,
              name: entry.name,
              relativePath: entry.name,
            });
          }
        }
      } catch {
        // Skip individual unreadable child (permissions / symlink loop).
      }
    }
  }

  return results;
}
