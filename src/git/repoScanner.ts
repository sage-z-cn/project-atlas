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
   * Path relative to the owning workspace root, always forward-slash separated.
   * `"."` for a repo sitting at the workspace root itself, otherwise the
   * sub-path such as `packages` or `packages/app`.
   */
  relativePath: string;
}

/**
 * 向下扫描的最大层数（工作区根记为第 1 层）：
 * 1 = 工作区根 + 直接子目录（`root/a`）；
 * 2 = 再加一层（`root/a/b`），即最多覆盖 3 层路径。
 * 深层扫描由用户手动触发，此常量是深度的硬上限。
 */
export const MAX_SCAN_DEPTH = 2;

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

/** Whether a directory entry is a candidate repo directory at any depth. */
function isCandidateDir(entry: Dirent): boolean {
  if (!entry.isDirectory()) return false;
  if (SKIP_DIRS.has(entry.name)) return false;
  // Skip dot-directories (e.g. .vscode, .cache) — not user repos.
  if (entry.name.startsWith(".")) return false;
  return true;
}

/**
 * Scan every workspace root for git repositories, breadth-first.
 *
 * For each root:
 *   1. If `<root>/.git` exists → register the root itself as a repo
 *      (relativePath `"."`).
 *   2. Walk down up to `maxDepth` directory levels (workspace root counted as
 *      level 1; `maxDepth` 2 therefore reaches `root/a/b`). Every candidate
 *      directory containing `.git` is registered, and the walk continues
 *      below it — nested repos / submodules must still be discovered.
 *      Non-directories, `node_modules`/`.git`, and dot-directories are
 *      filtered at every level.
 *
 * Robustness:
 *   - A single unreadable root/directory (permissions, broken symlink) is
 *     skipped and never aborts the whole scan.
 *   - Duplicate normalized paths are deduplicated so an overlapping
 *     multi-root workspace cannot produce two services for one repo.
 *   - Output order is deterministic: for each root the root repo first, then
 *     the remaining repos in breadth-first order (readdir order within each
 *     directory). RepoRegistry relies on `infos[0]` as a sane default
 *     fallback for currentRepoPath.
 */
export async function scanRepos(
  workspaceRoots: string[],
  options?: { maxDepth?: number },
): Promise<RepoInfo[]> {
  const requestedDepth = options?.maxDepth ?? 1;
  // 深度硬限制在 [1, MAX_SCAN_DEPTH]，非法值按 1 处理。
  const maxDepth = Number.isFinite(requestedDepth)
    ? Math.min(Math.max(Math.floor(requestedDepth), 1), MAX_SCAN_DEPTH)
    : 1;

  const results: RepoInfo[] = [];
  const seen = new Set<string>();

  /** 把命中 `.git` 的目录登记为仓库（按 normalized path 去重）。 */
  const register = (absDir: string, relativePath: string): void => {
    const normalized = normalizePath(absDir);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    results.push({
      path: normalized,
      name: path.basename(normalized),
      relativePath,
    });
  };

  for (const root of workspaceRoots) {
    // 1. Root repo
    if (await isGitRepo(root)) {
      register(root, ".");
    }

    // 2. Breadth-first walk: level 1 = direct children of root, level 2 =
    //    their children, ...
    let currentLevel: Array<{ abs: string; rel: string }> = [
      { abs: root, rel: "" },
    ];
    for (let depth = 1; depth <= maxDepth && currentLevel.length > 0; depth++) {
      const nextLevel: Array<{ abs: string; rel: string }> = [];

      for (const dir of currentLevel) {
        let entries: Dirent[];
        try {
          entries = await nodefs.readdir(dir.abs, { withFileTypes: true });
        } catch {
          // Unreadable directory (permissions / missing) — skip its subtree.
          continue;
        }

        const candidates = entries.filter(isCandidateDir);
        // Per-directory parallel `.git` probes; Promise.all preserves the
        // candidate order so registration stays deterministic.
        const flags = await Promise.all(
          candidates.map((entry) => isGitRepo(path.join(dir.abs, entry.name))),
        );

        for (let i = 0; i < candidates.length; i++) {
          const name = candidates[i].name;
          const absPath = path.join(dir.abs, name);
          const relPath = dir.rel ? `${dir.rel}/${name}` : name;
          if (flags[i]) {
            register(absPath, relPath);
          }
          if (depth < maxDepth) {
            nextLevel.push({ abs: absPath, rel: relPath });
          }
        }
      }

      currentLevel = nextLevel;
    }
  }

  return results;
}
