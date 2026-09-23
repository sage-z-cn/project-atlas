import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { GitCache } from "./cache";
import { computeGraphLayout } from "./graphLayout";
import { logger } from "../utils/logger";
import type {
  BranchInfo,
  CherryPickState,
  CommitNode,
  DiffFile,
  FileStatus,
  GraphLayoutResult,
  LaneSnapshot,
  LogOptions,
  MergeState,
  RefInfo,
  NewVersionCommitSummary,
  TagInfo,
} from "./types";

const execFileAsync = promisify(execFile);

// For parsing git output (actual null byte)
const FIELD_SEP = "\x00";
const RECORD_SEP = "\x00\x00\x01";
// For git log --format (pretty-format): %x00 produces null byte
const FMT_FIELD_SEP = "%x00";
const FMT_RECORD_SEP = "%x00%x00%x01";
// For git branch/tag --format (ref-format / for-each-ref): %00 produces null byte
const REF_FMT_FIELD_SEP = "%00";
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

/**
 * 只读 git 子命令集合:status/diff/log 等读命令会顺带"机会性"刷新 index
 * 并写入 .git/index,与用户同时在终端跑的 git 抢 index.lock,产生假
 * "Unable to create index.lock: File exists" 失败。对这些命令自动加
 * --no-optional-locks,声明本调用不取机会性锁。写命令(commit/push/
 * add/...)不受影响,保持原样。
 */
const READ_ONLY_COMMANDS = new Set([
  "status",
  "log",
  "branch",
  "tag",
  "for-each-ref",
  "remote",
  "config",
  "blame",
  "diff",
  "show",
  "rev-parse",
  "merge-base",
  "describe",
  "reflog",
  "ls-files",
  "cat-file",
  "name-rev",
  "check-ignore",
  "symbolic-ref",
  "shortlog",
]);

function withNoOptionalLocks(args: string[]): string[] {
  if (args.length === 0) return args;
  const cmd = args[0];
  const isReadOnly =
    READ_ONLY_COMMANDS.has(cmd) ||
    // stash 的 list/show 是只读;push/pop/apply/drop/branch 是写操作。
    (cmd === "stash" && (args[1] === "list" || args[1] === "show"));
  return isReadOnly ? ["--no-optional-locks", ...args] : args;
}

const LOG_FORMAT = [
  "%H", // hash
  "%h", // shortHash
  "%P", // parents (space separated)
  "%aN", // authorName (mailmap resolved)
  "%aE", // authorEmail (mailmap resolved)
  "%aI", // authorDate ISO 8601
  "%s", // subject
  "%b", // body
  "%D", // refs
].join(FMT_FIELD_SEP);

export class GitService {
  /**
   * Ref-derived data cache (log / branches / tags)。TTL 10min 仅是安全网:
   * 正确性由事件驱动失效保证 —— GitWatcher 区分 refs 类变化(HEAD/
   * refs/** 变更 → invalidateCache 全清)与 index 类变化(保存/stage →
   * 仅 invalidateStatusCache),log/branches/tags 对给定 refs 集合是不变
   * 数据,index 变化不需要也不应该清掉它们。外部进程绕过 watcher 的
   * 变化(锁文件 + 原子 rename 漏报)由窗口聚焦时的全量失效兜底。
   */
  readonly cache = new GitCache(10 * 60 * 1000);

  // 短 TTL（1.5s）缓存仅供 getWorkingTreeChanges 合并同一事件窗口内的
  // 多个调用方（状态栏/徽标/getRepoStatuses/fetchChanges）；真实变化由
  // watcher 到期时的分类失效（见 gitWatcher.ts）保证。
  private readonly statusCache = new GitCache(1500);

  /**
   * Stash 列表缓存（含每条的文件列表,整体缓存）。失效语义跟 index 走:
   * stash 写操作显式全清;外部终端 stash 改写 .git/index → watcher 分类
   * 失效;TTL 仅为安全网。每次 fetch 是 1 次 stash list + N 次 stash show
   * (每条一 spawn),不缓存的话 commit 面板每个事件窗口都全量重跑。
   */
  private readonly stashCache = new GitCache(10 * 60 * 1000);

  /**
   * Config-derived quasi-static cache（remote 配置、user identity）。
   * 这些数据只在 .git/config 变化时才会改变 —— gitWatcher 监听 config
   * 文件并调用 invalidateConfigCache()。global config（user.name 等可
   * 配置在全局）没有 watcher,由窗口聚焦时的全量 invalidateCache 兜底。
   * TTL 10min 同样只是安全网。
   */
  private readonly configCache = new GitCache(10 * 60 * 1000);

  constructor(readonly cwd: string) {}

  private async execGit(
    args: string[],
    maxBuffer = MAX_BUFFER,
  ): Promise<string> {
    const { stdout } = await execFileAsync("git", withNoOptionalLocks(args), {
      cwd: this.cwd,
      maxBuffer,
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return stdout;
  }

  async checkGitAvailable(): Promise<boolean> {
    try {
      await this.execGit(["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  async getLog(options: LogOptions = {}): Promise<CommitNode[]> {
    const cacheKey = `log:${JSON.stringify(options)}`;
    const cached = this.cache.get<CommitNode[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const args = [
      "log",
      `--format=${LOG_FORMAT}${FMT_RECORD_SEP}`,
      "--date-order",
    ];

    if (options.maxCount) {
      args.push(`--max-count=${options.maxCount}`);
    } else {
      args.push("--max-count=200");
    }
    if (options.skip) {
      args.push(`--skip=${options.skip}`);
    }
    if (options.author) {
      args.push(`--author=${options.author}`);
    }
    if (options.search) {
      args.push("-i", "--fixed-strings", `--grep=${options.search}`);
    }
    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    if (options.branch) {
      args.push(options.branch);
    } else {
      args.push("--all");
    }
    if (options.file) {
      args.push("--", options.file);
    }

    const output = await this.execGit(args);
    const commits = parseLogOutput(output);
    this.cache.set(cacheKey, commits);
    return commits;
  }

  /**
   * Commits since a ref (exclusive) up to HEAD, for the new version assistant.
   * fromRef 为 null 时返回从根开始的全部历史（封顶 maxCount 条）。
   * 返回轻量摘要，供 webview 提交列表 + AI changelog 输入 + 版本号建议共用。
   *
   * Not cached: new version scenarios re-pull on demand and the result set is small.
   */
  async getLogRange(
    fromRef: string | null,
    maxCount = 500,
  ): Promise<NewVersionCommitSummary[]> {
    const args = [
      "log",
      // %x1f = unit separator — subject lines cannot contain it, unlike spaces
      "--format=%H%x1f%s%x1f%an%x1f%at",
      `--max-count=${maxCount}`,
      fromRef ? `${fromRef}..HEAD` : "HEAD",
    ];

    let output: string;
    try {
      output = await this.execGit(args);
    } catch (err) {
      // Unborn branch (repo without any commit yet): git exits non-zero with
      // "your current branch ... does not have any commits yet" — an empty
      // history, not a failure. Other errors (e.g. bad revision) bubble up.
      const msg = err instanceof Error ? err.message : String(err);
      if (/does not have any commits yet/i.test(msg)) {
        return [];
      }
      throw err;
    }

    const commits: NewVersionCommitSummary[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line) {
        continue;
      }
      const parts = line.split("\x1f");
      if (parts.length < 4) {
        continue;
      }
      // %at = unix seconds; Date renders it in the local timezone
      const d = new Date(parseInt(parts[3] ?? "0", 10) * 1000);
      commits.push({
        hash: parts[0] ?? "",
        subject: parts[1] ?? "",
        author: parts[2] ?? "",
        shortDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        date: d.toISOString(),
      });
    }
    return commits;
  }

  /**
   * Resolve the commit hash that last touched `relativePath` at the given
   * 1-based line, via a single-line `git blame --line-porcelain`.
   *
   * Returns the 40-char SHA, or null when the line is uncommitted (git emits an
   * all-zero SHA), the path has no history, or the content is unblameable
   * (binary). Throws on git failure — callers (the BlameHoverProvider) catch.
   *
   * Not cached: VSCode debounces hover on the same position, and a single-line
   * blame is cheap (~tens of ms). The provider keeps its own last-line cache.
   */
  async blameLine(relativePath: string, line: number): Promise<string | null> {
    const output = await this.execGit(
      ["blame", `-L${line},${line}`, "--line-porcelain", "--", relativePath],
      1024 * 1024,
    );
    // --line-porcelain: each chunk begins with "<40-hex-sha> <orig-line> <final-line>".
    const nl = output.indexOf("\n");
    const header = nl === -1 ? output : output.slice(0, nl);
    const hash = header.split(" ", 1)[0];
    if (!hash || /^0+$/.test(hash)) return null; // all-zero SHA = uncommitted
    return /^[0-9a-f]{7,40}$/i.test(hash) ? hash : null;
  }

  /**
   * Find the 0-based row index of `hash` in `git log --all --date-order` output
   * — the exact ordering getLog() uses for the unfiltered graph, so this index
   * maps 1:1 to a `--skip` value.
   *
   * Used by locateCommitInLog to jump DIRECTLY to the page containing a commit
   * instead of paging from the top: every `git log --skip=N` is O(N) (git walks
   * past N commits), so paging to a commit thousands back is O(N²) and effectively
   * never finishes for big repos. One full walk here is O(N) total.
   *
   * Returns -1 when the hash isn't reachable from any ref (--all) — e.g. an
   * orphaned/gc'd commit. `hash` may be full or short; output rows are full.
   */
  async findCommitOffset(hash: string): Promise<number> {
    // Override the default 10MB cap: --format=%H emits ~41 bytes/commit, so the
    // default throws at ~255k commits — exactly the big-repo case this jump
    // exists for. 256MB covers ~6M commits (well past Linux-class repos). The
    // buffer grows on demand, so small repos pay nothing.
    const output = await this.execGit(
      ["log", "--all", "--date-order", "--format=%H"],
      256 * 1024 * 1024,
    );
    const target = hash.trim().toLowerCase();
    if (!target) return -1;
    let lineStart = 0;
    let idx = 0;
    while (lineStart < output.length) {
      const nl = output.indexOf("\n", lineStart);
      const lineEnd = nl === -1 ? output.length : nl;
      const line = output.slice(lineStart, lineEnd).trim().toLowerCase();
      if (
        line &&
        (line === target || line.startsWith(target) || target.startsWith(line))
      ) {
        return idx;
      }
      idx++;
      if (nl === -1) break;
      lineStart = nl + 1;
    }
    return -1;
  }

  async getGraphTopology(
    options: LogOptions = {},
    prevSnapshot?: LaneSnapshot,
  ): Promise<GraphLayoutResult> {
    const commits = await this.getLog(options);
    // breakHiddenParents: when the commit list is filtered down (by file,
    // search, author, or date range), the parent chain has gaps — e.g. in file
    // history most commits' first parent is an intermediate commit that doesn't
    // touch the file and is therefore absent from the list. Without breaking
    // those hidden parents, the lane allocator reserves each invisible parent
    // in its own lane and never recycles it (the parent never appears to
    // consume the lane), so every commit appends a fresh lane and columns grow
    // monotonically → the graph renders as a diagonal staircase. Breaking
    // hidden parents frees the lane after a stub so lanes recycle (typically
    // collapsing to a single column). branch-only filters are excluded because
    // a single branch's history is a contiguous ancestry path (no gaps).
    // breakHiddenParents: when the commit list is filtered or is a jumped-to
    // window (locateCommitInLog), parent chains have gaps — invisible parents
    // must be "broken" so the lane allocator recycles their lanes instead of
    // reserving one per missing parent (which collapses into a staircase).
    const breakHiddenParents =
      options.breakHiddenParents ??
      !!(
        options.search ||
        options.file ||
        options.author ||
        options.since ||
        options.until
      );
    return computeGraphLayout(commits, prevSnapshot, breakHiddenParents);
  }

  // noCache: 跳过 5s TTL 缓存直接读 git。供 ahead/behind 徽章等必须实时
  // 反映外部进程操作的调用方使用——git 更新 refs 走 lockfile + 原子
  // rename,VSCode FS watcher 对此可能漏报,缓存失效链路不保证及时。
  // 结果仍写回缓存以刷新 TTL。
  async getBranches(options?: { noCache?: boolean }): Promise<BranchInfo[]> {
    const cacheKey = "branches:v2";
    if (!options?.noCache) {
      const cached = this.cache.get<BranchInfo[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const format = [
      "%(refname)", // full ref — distinguishes refs/heads vs refs/remotes
      "%(refname:short)",
      "%(HEAD)",
      "%(upstream:short)",
      "%(upstream:track,nobracket)",
      "%(objectname:short)",
      "%(authorname)",
      "%(authoremail)",
    ].join(REF_FMT_FIELD_SEP);

    // Single for-each-ref invocation lists local AND remote branches in one
    // subprocess (previously two spawns: `git branch --format` +
    // `git branch -r --format`). This sits on the hot badge-refresh path —
    // getRepoStatuses runs it for every refreshed repo — so the spawn count
    // matters more than anything else here. Ordering: for-each-ref sorts by
    // refname, and "refs/heads/..." sorts before "refs/remotes/...", matching
    // the previous local-first, remote-second concatenation order.
    const output = await this.execGit([
      "for-each-ref",
      "refs/heads",
      "refs/remotes",
      `--format=${format}`,
    ]);

    const branches: BranchInfo[] = [];

    for (const line of output.trim().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const fields = line.split(FIELD_SEP);
      const fullRef = fields[0] ?? "";
      const name = fields[1]?.trim() ?? "";

      if (fullRef.startsWith("refs/remotes/")) {
        // Skip HEAD pointers like origin/HEAD. Also skip stray symref
        // remnants: refs/remotes/origin/HEAD renders as "origin" (no
        // slash), which would otherwise leak through as a bogus remote
        // branch. Legitimate remote tracking branches are always
        // "remote/branch".
        if (name.endsWith("/HEAD") || !name.includes("/")) {
          continue;
        }

        branches.push({
          name,
          isRemote: true,
          isCurrent: false,
          ahead: 0,
          behind: 0,
          lastCommitHash: fields[5]?.trim() ?? "",
        });
        continue;
      }

      const isCurrent = fields[2]?.trim() === "*";
      const upstream = fields[3]?.trim() || undefined;
      const track = fields[4]?.trim() ?? "";
      const { ahead, behind } = parseTrack(track);

      branches.push({
        name,
        isRemote: false,
        isCurrent,
        upstream,
        ahead,
        behind,
        lastCommitHash: fields[5]?.trim() ?? "",
        authorName: fields[6]?.trim(),
        authorEmail: fields[7]?.trim().replace(/[<>]/g, ""),
      });
    }

    this.cache.set(cacheKey, branches);
    return branches;
  }

  async getUserIdentity(): Promise<{ name: string; email: string }> {
    // Config-derived quasi-static data: cached until .git/config changes
    // (gitWatcher → invalidateConfigCache). Sits on the hot path — every
    // panel fetchInitialData round requests it.
    const cached = this.configCache.get<{ name: string; email: string }>(
      "identity",
    );
    if (cached) return cached;
    // Two independent queries — run concurrently instead of serially.
    const [name, email] = await Promise.all([
      this.execGit(["config", "user.name"]).catch(() => ""),
      this.execGit(["config", "user.email"]).catch(() => ""),
    ]);
    const identity = { name: name.trim(), email: email.trim() };
    this.configCache.set("identity", identity);
    return identity;
  }

  async getRemoteBranches(): Promise<{ remote: string; branches: string[] }[]> {
    // Get the actual configured remotes (not inferred from tracking branches)
    const remoteOutput = await this.execGit(["remote"]).catch(() => "");
    const configuredRemotes = new Set(
      remoteOutput
        .trim()
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
    );

    if (configuredRemotes.size === 0) {
      return [];
    }

    const allBranches = await this.getBranches();
    const remoteBranches = allBranches.filter((b) => b.isRemote);

    const groups = new Map<string, string[]>();
    for (const branch of remoteBranches) {
      const slashIdx = branch.name.indexOf("/");
      if (slashIdx === -1) continue;
      const remote = branch.name.substring(0, slashIdx);
      // Only include branches for remotes that still exist
      if (!configuredRemotes.has(remote)) continue;
      const branchName = branch.name.substring(slashIdx + 1);
      if (!groups.has(remote)) {
        groups.set(remote, []);
      }
      groups.get(remote)?.push(branchName);
    }

    // Ensure all configured remotes appear even if they have no tracking branches yet
    for (const remote of configuredRemotes) {
      if (!groups.has(remote)) {
        groups.set(remote, []);
      }
    }

    // Sort branches alphabetically within each group (case-insensitive)
    const result: { remote: string; branches: string[] }[] = [];
    for (const [remote, branchList] of groups) {
      branchList.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
      result.push({ remote, branches: branchList });
    }

    return result;
  }

  async getTags(): Promise<TagInfo[]> {
    const cacheKey = "tags";
    const cached = this.cache.get<TagInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const tagFormat = [
      "%(refname:short)",
      "%(objectname:short)",
      "%(objecttype)",
      "%(contents:subject)",
      "%(creatordate:unix)",
    ].join(REF_FMT_FIELD_SEP);

    // --sort=-creatordate: newest tags first (creator date desc).
    const output = await this.execGit([
      "tag",
      "-l",
      "--sort=-creatordate",
      `--format=${tagFormat}`,
    ]).catch(() => "");

    const tags: TagInfo[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const fields = line.split(FIELD_SEP);
      tags.push({
        name: fields[0]?.trim() ?? "",
        hash: fields[1]?.trim() ?? "",
        isAnnotated: fields[2]?.trim() === "tag",
        message: fields[3]?.trim() || undefined,
        date: fields[4]?.trim() || undefined,
      });
    }

    this.cache.set(cacheKey, tags);
    return tags;
  }

  /**
   * creatordate 最新且位于 HEAD 历史（tag 指向的提交是 HEAD 的祖先）的
   * tag 名；无 tag 或 unborn HEAD 时返回 null。
   *
   * 单次 for-each-ref --merged=HEAD 完成"全部 tags 的可达性过滤 + 排序 +
   * 取第一条"，替代此前 collectNewVersionContext 里逐 tag 串行
   * `merge-base --is-ancestor` 的循环 —— fork/clone 仓库常携带大量上游
   * tags 且全部不可达，串行 merge-base 在大仓库上每次数百毫秒，N 个 tag
   * 轻松累计几十秒（击穿 webview 请求超时）。附注 tag 与 --merged 的语义
   * 由 git 自动解引用到提交，与 merge-base --is-ancestor 一致。
   */
  async getLatestMergedTag(): Promise<string | null> {
    try {
      const output = await this.execGit([
        "for-each-ref",
        "--merged=HEAD",
        "refs/tags",
        "--sort=-creatordate",
        "--count=1",
        "--format=%(refname:short)",
      ]);
      const name = output.trim();
      return name || null;
    } catch {
      // unborn HEAD（仓库还没有任何 commit）等原因导致 HEAD 不可解析。
      return null;
    }
  }

  async getDiff(ref1: string, ref2: string, file?: string): Promise<string> {
    const args = ["diff", ref1, ref2];
    if (file) {
      args.push("--", file);
    }
    return this.execGit(args);
  }

  /**
   * 获取已暂存改动的 unified diff（git diff --cached）。
   * 用于 AI commit message 生成时 VSCode 风格的"暂存优先"策略。
   */
  async getStagedPatch(): Promise<string> {
    try {
      return await this.execGit(["diff", "--cached"]);
    } catch {
      return "";
    }
  }

  async getFileContent(ref: string, filePath: string): Promise<string> {
    // "empty" is a URI sentinel for "no content" (deleted / added side), not a
    // real git ref. A branch named `empty` must not leak into these diffs.
    if (!ref || ref === "empty") {
      return "";
    }
    try {
      return await this.execGit(["show", `${ref}:${filePath}`]);
    } catch {
      // stash 提交的第三个父提交（^3，仅 -u 贮藏时存在）存放未跟踪文件。
      // 仅对 commit 形态的 ref（对象名 / stash 引用）回退；index stage
      // （:0/:1/…）与 HEAD 等符号引用走 ^3 无意义且可能读到错误内容。
      if (!canHaveStashUntrackedParent(ref)) {
        return "";
      }
      try {
        return await this.execGit(["show", `${ref}^3:${filePath}`]);
      } catch {
        return "";
      }
    }
  }

  async getFileContentBuffer(ref: string, filePath: string): Promise<Buffer> {
    if (!ref || ref === "empty") {
      return Buffer.alloc(0);
    }
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["show", `${ref}:${filePath}`],
        {
          cwd: this.cwd,
          maxBuffer: MAX_BUFFER,
          encoding: "buffer",
          env: {
            ...process.env,
            LC_ALL: "C",
            GIT_TERMINAL_PROMPT: "0",
          },
        },
      );
      return stdout;
    } catch {
      // 与 getFileContent 对称：二进制未跟踪文件（如图片）也存放在 stash 的
      // ^3 父提交中。同样仅对 commit 形态 ref 回退。
      if (!canHaveStashUntrackedParent(ref)) {
        return Buffer.alloc(0);
      }
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["show", `${ref}^3:${filePath}`],
          {
            cwd: this.cwd,
            maxBuffer: MAX_BUFFER,
            encoding: "buffer",
            env: {
              ...process.env,
              LC_ALL: "C",
              GIT_TERMINAL_PROMPT: "0",
            },
          },
        );
        return stdout;
      } catch {
        return Buffer.alloc(0);
      }
    }
  }

  async getCommitFiles(hash: string): Promise<DiffFile[]> {
    // -m --first-parent: without -m, diff-tree emits nothing for merge commits
    // (UI then falls back to "select a commit"). First-parent is the
    // GitHub/GitLens convention and matches openDiffEditor's leftRef = parents[0].
    const output = await this.execGit([
      "diff-tree",
      "--root",
      "--no-commit-id",
      "-r",
      "--name-status",
      "-M",
      "-m",
      "--first-parent",
      hash,
    ]);
    return parseDiffNameStatus(output);
  }

  async getCommitRangeFiles(hashes: string[]): Promise<DiffFile[]> {
    if (hashes.length === 0) return [];
    if (hashes.length === 1) return this.getCommitFiles(hashes[0]);

    // Cherry-pick style: get diff-tree for each commit individually, then merge
    const perCommitFiles = await Promise.all(
      hashes.map((h) => this.getCommitFiles(h)),
    );

    const merged = new Map<string, DiffFile>();
    for (const files of perCommitFiles) {
      for (const f of files) {
        const key = f.newPath || f.oldPath;
        if (!merged.has(key)) {
          merged.set(key, f);
        }
      }
    }
    return Array.from(merged.values());
  }

  async findFileRange(
    hashes: string[],
    filePath: string,
  ): Promise<{ oldest: string; newest: string } | null> {
    // From hashes (newest first), find commits that touch this file
    const touching: string[] = [];
    for (const h of hashes) {
      const files = await this.getCommitFiles(h);
      if (files.some((f) => f.newPath === filePath || f.oldPath === filePath)) {
        touching.push(h);
      }
    }
    if (touching.length === 0) return null;
    return { newest: touching[0], oldest: touching[touching.length - 1] };
  }

  async getStatus(): Promise<FileStatus[]> {
    const output = await this.execGit(["status", "--porcelain=v1"]);
    const files: FileStatus[] = [];

    for (const line of output.split("\n")) {
      if (line.length < 4) {
        continue;
      }
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const rest = line.substring(3);

      // Handle renames: "R  old -> new"
      const arrowIdx = rest.indexOf(" -> ");
      if (arrowIdx !== -1) {
        files.push({
          path: unquoteGitPath(rest.substring(arrowIdx + 4)),
          oldPath: unquoteGitPath(rest.substring(0, arrowIdx)),
          indexStatus,
          workTreeStatus,
        });
      } else {
        files.push({
          path: unquoteGitPath(rest),
          indexStatus,
          workTreeStatus,
        });
      }
    }
    return files;
  }

  async getCommitParents(hash: string): Promise<string[]> {
    const output = await this.execGit(["rev-parse", `${hash}^@`]).catch(
      () => "",
    );
    return output
      .trim()
      .split("\n")
      .filter((s) => s.length > 0);
  }

  async getMergeState(): Promise<MergeState> {
    try {
      const mergeHead = (
        await fs.readFile(path.join(this.cwd, ".git", "MERGE_HEAD"), "utf-8")
      ).trim();
      let mergeMsg = "";
      try {
        mergeMsg = (
          await fs.readFile(path.join(this.cwd, ".git", "MERGE_MSG"), "utf-8")
        ).trim();
      } catch {}
      return { isMerging: true, mergeHead, mergeMsg };
    } catch {
      return { isMerging: false };
    }
  }

  async getCherryPickState(): Promise<CherryPickState> {
    try {
      const cherryPickHead = (
        await fs.readFile(
          path.join(this.cwd, ".git", "CHERRY_PICK_HEAD"),
          "utf-8",
        )
      ).trim();
      return { isCherryPicking: true, cherryPickHead };
    } catch {
      return { isCherryPicking: false };
    }
  }

  async cherryPickAction(action: "continue" | "abort" | "skip"): Promise<void> {
    if (action === "continue") {
      // Stage all resolved files before continuing (like IntelliJ IDEA behavior)
      await this.execGit(["add", "-u"]);
      // Use --allow-empty to handle the case where cherry-pick becomes empty after conflict resolution
      try {
        await this.execGit(["cherry-pick", "--continue"]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("allow-empty")) {
          await this.execGit(["commit", "--allow-empty"]);
        } else {
          throw err;
        }
      }
    } else if (action === "skip") {
      await this.execGit(["cherry-pick", "--skip"]);
    } else {
      await this.execGit(["cherry-pick", "--abort"]);
    }
    this.invalidateCache();
  }

  async getRebaseState(): Promise<{
    isRebasing: boolean;
    branchName?: string;
    step?: number;
    totalSteps?: number;
  }> {
    const rebaseMergePath = path.join(this.cwd, ".git", "rebase-merge");
    const rebaseApplyPath = path.join(this.cwd, ".git", "rebase-apply");
    try {
      await fs.access(rebaseMergePath);
      let branchName = "";
      let step = 0;
      let totalSteps = 0;
      try {
        const headName = await fs.readFile(
          path.join(rebaseMergePath, "head-name"),
          "utf-8",
        );
        branchName = headName.trim().replace("refs/heads/", "");
      } catch {}
      try {
        const msgnum = await fs.readFile(
          path.join(rebaseMergePath, "msgnum"),
          "utf-8",
        );
        step = Number.parseInt(msgnum.trim(), 10);
      } catch {}
      try {
        const end = await fs.readFile(
          path.join(rebaseMergePath, "end"),
          "utf-8",
        );
        totalSteps = Number.parseInt(end.trim(), 10);
      } catch {}
      return { isRebasing: true, branchName, step, totalSteps };
    } catch {}
    try {
      await fs.access(rebaseApplyPath);
      let branchName = "";
      let step = 0;
      let totalSteps = 0;
      try {
        const headName = await fs.readFile(
          path.join(rebaseApplyPath, "head-name"),
          "utf-8",
        );
        branchName = headName.trim().replace("refs/heads/", "");
      } catch {}
      try {
        const next = await fs.readFile(
          path.join(rebaseApplyPath, "next"),
          "utf-8",
        );
        step = Number.parseInt(next.trim(), 10);
      } catch {}
      try {
        const last = await fs.readFile(
          path.join(rebaseApplyPath, "last"),
          "utf-8",
        );
        totalSteps = Number.parseInt(last.trim(), 10);
      } catch {}
      return { isRebasing: true, branchName, step, totalSteps };
    } catch {}
    return { isRebasing: false };
  }

  async getConflictFiles(): Promise<string[]> {
    const output = await this.execGit([
      "diff",
      "--name-only",
      "--diff-filter=U",
    ]);
    return output
      .trim()
      .split("\n")
      .filter((s) => s.length > 0)
      .map(unquoteGitPath);
  }

  async getFileVersions(
    filePath: string,
  ): Promise<{ base: string; ours: string; theirs: string }> {
    const [base, ours, theirs] = await Promise.all([
      this.getFileContent(":1", filePath),
      this.getFileContent(":2", filePath),
      this.getFileContent(":3", filePath),
    ]);
    return { base, ours, theirs };
  }

  async saveMergedContent(filePath: string, content: string): Promise<void> {
    await fs.writeFile(path.join(this.cwd, filePath), content, "utf-8");
  }

  async stageFile(filePath: string): Promise<void> {
    await this.execGit(["add", filePath]);
  }

  async acceptOurs(filePath: string): Promise<void> {
    await this.execGit(["checkout", "--ours", filePath]);
    await this.execGit(["add", filePath]);
  }

  async acceptTheirs(filePath: string): Promise<void> {
    await this.execGit(["checkout", "--theirs", filePath]);
    await this.execGit(["add", filePath]);
  }

  async checkout(branchName: string): Promise<void> {
    await this.execGit(["checkout", branchName]);
    this.invalidateCache();
  }

  async createBranch(
    newBranchName: string,
    startPoint: string,
    force = false,
  ): Promise<void> {
    const args = force
      ? ["branch", "-f", newBranchName, startPoint]
      : ["branch", newBranchName, startPoint];
    await this.execGit(args);
    this.invalidateCache();
  }

  async deleteBranch(branchName: string, force = false): Promise<void> {
    const flag = force ? "-D" : "-d";
    await this.execGit(["branch", flag, branchName]);
    this.invalidateCache();
  }

  async deleteRemoteBranch(remoteBranch: string): Promise<void> {
    // remoteBranch is like "origin/feature" → push --delete origin feature
    const slashIdx = remoteBranch.indexOf("/");
    const remote = remoteBranch.substring(0, slashIdx);
    const branch = remoteBranch.substring(slashIdx + 1);
    try {
      await this.execGit(["push", remote, "--delete", branch]);
    } catch (err) {
      // Idempotent: if the remote ref is already gone, the user's goal
      // (remote branch no longer exists) is already satisfied. git exits
      // non-zero with "remote ref does not exist" in stderr in that case.
      const msg = err instanceof Error ? err.message : String(err);
      if (/remote ref does not exist/i.test(msg)) {
        // Fall through to cache invalidation / success.
      } else {
        throw err;
      }
    }
    this.invalidateCache();
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.execGit(["branch", "-m", oldName, newName]);
    this.invalidateCache();
  }

  /**
   * Point a local branch at a remote-tracking branch
   * (`git branch --set-upstream-to=origin/main feature`).
   * remoteBranch must be the full remote-tracking name (e.g. `origin/main`).
   */
  async setUpstream(
    branchName: string,
    remoteBranch: string,
  ): Promise<void> {
    await this.execGit([
      "branch",
      `--set-upstream-to=${remoteBranch}`,
      branchName,
    ]);
    this.invalidateCache();
  }

  /** Remove tracking config for a local branch (`git branch --unset-upstream`). */
  async unsetUpstream(branchName: string): Promise<void> {
    await this.execGit(["branch", "--unset-upstream", branchName]);
    this.invalidateCache();
  }

  async merge(branchName: string): Promise<void> {
    await this.execGit(["merge", branchName]);
    this.invalidateCache();
  }

  async rebase(onto: string): Promise<void> {
    await this.execGit(["rebase", onto]);
    this.invalidateCache();
  }

  async rebaseAction(action: "continue" | "abort" | "skip"): Promise<void> {
    if (action === "continue") {
      // Stage all resolved files before continuing
      await this.execGit(["add", "-u"]);
    }
    await this.execGit(["rebase", `--${action}`]);
    this.invalidateCache();
  }

  async mergeAbort(): Promise<void> {
    await this.execGit(["merge", "--abort"]);
    this.invalidateCache();
  }

  async mergeContinue(): Promise<void> {
    // Stage all resolved files before committing
    await this.execGit(["add", "-u"]);
    await this.execGit(["commit", "--no-edit"]);
    this.invalidateCache();
  }

  async checkoutAndRebase(
    branchToCheckout: string,
    rebaseOnto: string,
  ): Promise<void> {
    await this.execGit(["checkout", branchToCheckout]);
    await this.execGit(["rebase", rebaseOnto]);
    this.invalidateCache();
  }

  async push(
    branchName: string,
    force = false,
    remote?: string,
    targetBranch?: string,
    withTags = false,
  ): Promise<string> {
    const args = ["push"];
    if (force) args.push("--force-with-lease");
    if (withTags) args.push("--tags");
    // Resolve the real remote name (upstream config → first configured remote)
    // instead of hard-coding "origin". See getDefaultRemote().
    const remoteName = remote ?? (await this.getDefaultRemote(branchName));
    args.push(remoteName, `${branchName}:${targetBranch || branchName}`);
    const output = await this.execGit(args);
    this.invalidateCache();
    return output;
  }

  /**
   * Get commits that are ahead of the remote tracking branch.
   * Returns commits in newest-first order.
   */
  async getAheadCommits(
    branchName: string,
    remote?: string,
  ): Promise<CommitNode[]> {
    const remoteName = remote || (await this.getDefaultRemote(branchName));
    const upstream = `${remoteName}/${branchName}`;
    // Check if upstream exists
    try {
      await this.execGit(["rev-parse", "--verify", upstream]);
    } catch {
      // No upstream — all local commits are "ahead"
      const args = [
        "log",
        `--format=${LOG_FORMAT}${FMT_RECORD_SEP}`,
        branchName,
        "--max-count=50",
      ];
      const output = await this.execGit(args);
      return parseLogOutput(output);
    }
    const args = [
      "log",
      `--format=${LOG_FORMAT}${FMT_RECORD_SEP}`,
      `${upstream}..${branchName}`,
    ];
    const output = await this.execGit(args);
    return parseLogOutput(output);
  }

  async pull(branchName?: string, remote?: string): Promise<void> {
    const args = ["pull", "--autostash"];
    if (branchName) {
      const remoteName = remote ?? (await this.getDefaultRemote(branchName));
      args.push(remoteName, branchName);
    }
    await this.execGit(args);
    this.invalidateCache();
  }

  async pullRebase(branchName?: string, remote?: string): Promise<void> {
    const args = ["pull", "--rebase", "--autostash"];
    if (branchName) {
      const remoteName = remote ?? (await this.getDefaultRemote(branchName));
      args.push(remoteName, branchName);
    }
    await this.execGit(args);
    this.invalidateCache();
  }

  async fetch(remote?: string): Promise<void> {
    const remoteName = remote ?? (await this.getDefaultRemote());
    await this.execGit(["fetch", remoteName]);
    this.invalidateCache();
  }

  async cherryPick(hash: string): Promise<void> {
    await this.execGit(["cherry-pick", hash]);
    this.invalidateCache();
  }

  /**
   * Append ignore patterns for the given repo-relative paths to `.gitignore`
   * at the repo root (created if missing). Paths already present (exact or
   * with a leading `/`) are skipped. Directories get a trailing slash.
   */
  async addToGitignore(
    paths: string[],
    mode: "file" | "folder" = "file",
  ): Promise<{ added: string[]; skipped: string[]; gitignorePath: string }> {
    const gitignorePath = path.join(this.cwd, ".gitignore");
    let content = "";
    try {
      content = await fs.readFile(gitignorePath, "utf-8");
    } catch {
      content = "";
    }

    const existing = new Set(
      content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );

    const added: string[] = [];
    const skipped: string[] = [];
    const newEntries: string[] = [];

    for (const raw of paths) {
      const pattern = this.toGitignorePattern(raw, mode);
      if (!pattern) {
        skipped.push(raw);
        continue;
      }
      const bare = pattern.replace(/\/$/, "");
      if (
        existing.has(pattern) ||
        existing.has(bare) ||
        existing.has(`/${pattern}`) ||
        existing.has(`/${bare}`) ||
        existing.has(`**/${bare}`) ||
        existing.has(`**/${pattern}`)
      ) {
        skipped.push(raw);
        continue;
      }
      newEntries.push(pattern);
      added.push(raw);
      existing.add(pattern);
    }

    if (newEntries.length > 0) {
      const needsNewline = content.length > 0 && !content.endsWith("\n");
      const prefix = content.length === 0 ? "" : needsNewline ? "\n" : "";
      await fs.appendFile(
        gitignorePath,
        `${prefix}${newEntries.join("\n")}\n`,
        "utf-8",
      );
      this.invalidateCache();
    }

    return { added, skipped, gitignorePath };
  }

  /** Absolute path of the repo-root `.gitignore` (may not exist yet). */
  getGitignorePath(): string {
    return path.join(this.cwd, ".gitignore");
  }

  private toGitignorePattern(
    relPath: string,
    mode: "file" | "folder",
  ): string | null {
    const normalized = String(relPath || "")
      .replace(/\\/g, "/")
      .replace(/^(\.\/)+/, "")
      .replace(/^\/+/, "");
    if (!normalized || normalized.split("/").includes("..")) {
      return null;
    }
    if (mode === "folder" || normalized.endsWith("/")) {
      return normalized.endsWith("/") ? normalized : `${normalized}/`;
    }
    return normalized;
  }

  /**
   * Sequentially cherry-pick commits oldest-first. Stops at the first
   * failure (conflict / empty / etc.) and reports how far it got.
   *
   * Order: `git rev-list --no-walk=unsorted --topo-order --reverse` so parent
   * commits are applied before their children regardless of the caller's
   * selection order or skewed committer dates (`sorted` orders by commit
   * time, which can invert parent/child after clock drift or history rewrites).
   */
  async cherryPickRange(hashes: string[]): Promise<{
    appliedHashes: string[];
    total: number;
    failedHash?: string;
    conflicted?: boolean;
    error?: string;
  }> {
    if (!hashes || hashes.length === 0) {
      throw new Error("No commits to cherry-pick");
    }

    let ordered = [...hashes];
    if (hashes.length > 1) {
      try {
        const out = await this.execGit([
          "rev-list",
          "--no-walk=unsorted",
          "--topo-order",
          "--reverse",
          ...hashes,
        ]);
        const sorted = out
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (sorted.length === hashes.length) {
          // rev-list emits full SHAs; if the caller passed short hashes,
          // map each full SHA back to the original entry when possible.
          ordered = sorted.map((full) => {
            if (hashes.includes(full)) return full;
            const short = hashes.find(
              (h) => full.startsWith(h) || h.startsWith(full),
            );
            return short ?? full;
          });
        }
      } catch {
        // Fall back to caller order if rev-list cannot resolve the set.
      }
    }

    const appliedHashes: string[] = [];
    for (const hash of ordered) {
      try {
        await this.execGit(["cherry-pick", hash]);
        appliedHashes.push(hash);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        let conflicted = false;
        try {
          // A failed cherry-pick also leaves CHERRY_PICK_HEAD when the
          // commit is already applied (empty) — only unresolved files
          // count as a real conflict.
          const conflicts = await this.getConflictFiles();
          conflicted = conflicts.length > 0;
        } catch {
          conflicted = false;
        }
        this.invalidateCache();
        return {
          appliedHashes,
          total: ordered.length,
          failedHash: hash,
          conflicted,
          error: message,
        };
      }
    }
    this.invalidateCache();
    return { appliedHashes, total: ordered.length };
  }

  async checkoutCommit(hash: string): Promise<void> {
    await this.execGit(["checkout", hash]);
    this.invalidateCache();
  }

  async checkoutFileFromCommit(hash: string, filePath: string): Promise<void> {
    await this.execGit(["checkout", hash, "--", filePath]);
    this.invalidateCache();
  }

  /**
   * 从 stash 检出单个文件到工作区。stash 主体提交只含被跟踪文件的改动，
   * `-u` 贮藏的未跟踪文件存放在第三个父提交（`<sha>^3`，仅在贮藏时存在
   * 未跟踪文件才有该父提交）。先用 cat-file -e 探测文件落在哪个树，再对
   * 正确的 ref 执行 checkout —— 与 getFileContent 的 ^3 回退语义一致。
   * 不改 checkoutFileFromCommit：它被 rollback 等功能共用，语义是纯 commit。
   */
  async checkoutFileFromStash(stashRef: string, filePath: string): Promise<void> {
    let ref: string | null = null;
    try {
      await this.execGit(["cat-file", "-e", `${stashRef}:${filePath}`]);
      ref = stashRef;
    } catch {
      try {
        await this.execGit(["cat-file", "-e", `${stashRef}^3:${filePath}`]);
        ref = `${stashRef}^3`;
      } catch {
        // 两个树都没有该文件：抛出明确错误，冒泡到 webview。
      }
    }
    if (!ref) {
      throw new Error(`"${filePath}" not found in stash ${stashRef}`);
    }
    await this.execGit(["checkout", ref, "--", filePath]);
    this.invalidateCache();
  }

  async checkoutFileFromParent(
    hash: string,
    filePath: string,
    status?: string,
  ): Promise<void> {
    if (status === "added") {
      // File was newly added in this commit, revert means removing it
      // Use --cached to handle case where file may not exist on disk
      try {
        await this.execGit(["rm", "-f", "--", filePath]);
      } catch {
        // File might not exist in working tree or index, try removing from index only
        try {
          await this.execGit(["rm", "-f", "--cached", "--", filePath]);
        } catch {
          // File doesn't exist at all - nothing to revert
        }
        // Also try to remove the physical file if it exists
        try {
          await fs.unlink(path.join(this.cwd, filePath));
        } catch {
          // File already doesn't exist on disk
        }
      }
    } else if (status === "deleted") {
      // File was deleted in this commit, revert means restoring it from parent
      await this.execGit(["checkout", `${hash}~1`, "--", filePath]);
    } else {
      // File was modified/renamed/copied, revert to parent state
      await this.execGit(["checkout", `${hash}~1`, "--", filePath]);
    }
    this.invalidateCache();
  }

  async resetToCommit(
    hash: string,
    mode: "soft" | "mixed" | "hard",
  ): Promise<void> {
    await this.execGit(["reset", `--${mode}`, hash]);
    this.invalidateCache();
  }

  async revertCommit(hash: string): Promise<void> {
    await this.execGit(["revert", "--no-edit", hash]);
    this.invalidateCache();
  }

  async dropCommit(hash: string): Promise<void> {
    const headHash = (await this.execGit(["rev-parse", "HEAD"])).trim();
    const isHead = hash === headHash;

    if (isHead) {
      await this.dropHeadCommit(hash);
    } else {
      await this.dropNonHeadCommit(hash);
    }
    this.invalidateCache();
  }

  private async dropHeadCommit(hash: string): Promise<void> {
    // Verify commit has a parent
    const parents = await this.getCommitParents(hash);
    if (parents.length === 0) {
      throw new Error("Cannot drop the initial commit (no parent)");
    }
    await this.execGit(["reset", "--mixed", "HEAD~1"]);
  }

  private async dropNonHeadCommit(hash: string): Promise<void> {
    // 1. Capture the target commit's diff BEFORE rebase
    const diff = await this.execGit(["diff-tree", "-p", hash]);

    // 2. Check working directory status
    const status = await this.execGit(["status", "--porcelain"]);
    const isDirty = status.trim().length > 0;

    // 3. Stash if dirty
    // 按完整 SHA 记录本次自动贮藏：恢复时按 SHA 寻址，避免无参 `stash pop`
    // 弹出他人在此期间（rebase 执行中）新产生的 stash@{0}。
    let autostashRef: string | undefined;
    if (isDirty) {
      await this.execGit([
        "stash",
        "push",
        "-u",
        "-m",
        "drop-commit-autostash",
      ]);
      try {
        autostashRef = (await this.execGit(["rev-parse", "stash@{0}"])).trim();
      } catch {
        // rev-parse 失败极罕见（push 已成功）；退回 stash@{0} 引用。
        autostashRef = "stash@{0}";
      }
    }

    // 4. Execute rebase to remove the commit
    try {
      await this.execGit(["rebase", "--onto", `${hash}^`, hash]);
    } catch (rebaseErr) {
      // Abort rebase on failure
      try {
        await this.execGit(["rebase", "--abort"]);
      } catch {
        // ignore abort errors
      }

      // Restore stash if it was used
      if (autostashRef) {
        await this.restoreAutoStash(autostashRef);
      }

      throw rebaseErr;
    }

    // 5. Restore stashed changes on success
    if (autostashRef) {
      await this.restoreAutoStash(autostashRef);
    }

    // 6. Apply dropped commit's diff to working directory via temp file
    if (diff.trim()) {
      const tmpFile = path.join(os.tmpdir(), `drop-commit-${hash}.patch`);
      try {
        await fs.writeFile(tmpFile, diff, "utf-8");
        await this.execGit(["apply", "--3way", tmpFile]);
      } catch {
        throw new Error(
          "Commit was removed from history but its changes could not be applied to the working directory",
        );
      } finally {
        try {
          await fs.unlink(tmpFile);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  /**
   * drop-commit 流程结束后的自动贮藏恢复：按记录的 SHA `stash pop`。
   * pop 失败降级为 logger 警告、不向上抛错 —— rebase 结果不应被次要的
   * stash 恢复失败推翻（pop 失败时 git 不会 drop 该 stash，条目仍保留
   * 在栈中，用户可手动恢复）。
   */
  private async restoreAutoStash(ref: string): Promise<void> {
    try {
      // pop 只接受 stash@{n} 引用形式：记录的 SHA 须先解析（见
      // resolveStashRefForm）。解析放在本 try 内 —— 自动贮藏已不在栈中
      //（解析抛错）与 pop 本身失败走同一条降级路径，只 warn 不破坏
      // dropCommit 流程。
      const refForm = await this.resolveStashRefForm(ref);
      await this.execGit(["stash", "pop", refForm]);
      // pop 成功后失效状态缓存：autostash pop 只改工作区/index、refs
      // 未动，index 层失效即可。
      this.invalidateStatusCache();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn(
        `dropCommit: auto-stash restore (${ref}) failed: ${detail}. ` +
          "If the stash entry is still in the stack, restore it manually via git stash pop.",
      );
    }
  }

  async createBranchFromCommit(
    branchName: string,
    hash: string,
    force = false,
  ): Promise<void> {
    const args = force
      ? ["branch", "-f", branchName, hash]
      : ["branch", branchName, hash];
    await this.execGit(args);
    this.invalidateCache();
  }

  async createTag(
    tagName: string,
    hash: string,
    message?: string,
  ): Promise<void> {
    if (message) {
      await this.execGit(["tag", "-a", tagName, hash, "-m", message]);
    } else {
      await this.execGit(["tag", tagName, hash]);
    }
    this.invalidateCache();
  }

  async deleteTag(tagName: string): Promise<void> {
    await this.execGit(["tag", "-d", tagName]);
    this.invalidateCache();
  }

  async pushTag(tagName: string, remote?: string): Promise<string> {
    const remoteName = remote ?? (await this.getDefaultRemote());
    const output = await this.execGit(["push", remoteName, tagName]);
    this.invalidateCache();
    return output;
  }

  // ─── Commit Panel Operations ───────────────────────────────────────

  async getWorkingTreeChanges(): Promise<import("./types").WorkingTreeFile[]> {
    // 同一事件窗口内多个调用方（状态栏/徽标/getRepoStatuses/fetchChanges）
    // 各自触发一次 `git status` 子进程，短 TTL 只为把它们合并为一次执行；
    // 真实变化由 watcher 的 svc.invalidateCache() 清缓存保证，不读旧值。
    const cached = this.statusCache.get<import("./types").WorkingTreeFile[]>(
      "wtChanges",
    );
    if (cached) {
      return cached;
    }
    const output = await this.execGit(["status", "--porcelain=v1", "-uall"]);
    const files: import("./types").WorkingTreeFile[] = [];

    // Map a single porcelain status code (X or Y) to a WorkingTreeFile status.
    // Each side (index / worktree) is resolved independently so a file's status
    // reflects the real state of that side — not a blend of both.
    const codeToStatus = (
      code: string,
    ): import("./types").WorkingTreeFile["status"] => {
      switch (code) {
        case "A":
          return "added";
        case "D":
          return "deleted";
        case "R":
          return "renamed";
        case "M":
        case "T": // type change
        case "C": // copied — no dedicated type, fold into modified
          return "modified";
        default:
          return "modified";
      }
    };

    for (const line of output.split("\n")) {
      if (line.length < 4) continue;
      const indexStatus = line[0];
      const workTreeStatus = line[1];

      // Skip ignored files
      if (indexStatus === "!" && workTreeStatus === "!") continue;

      const rest = line.substring(3);
      const arrowIdx = rest.indexOf(" -> ");
      const filePath = unquoteGitPath(
        arrowIdx !== -1 ? rest.substring(arrowIdx + 4) : rest,
      );
      const oldPath =
        arrowIdx !== -1
          ? unquoteGitPath(rest.substring(0, arrowIdx))
          : undefined;

      // Untracked file (??) — single untracked entry, never staged
      if (indexStatus === "?" && workTreeStatus === "?") {
        files.push({ path: filePath, oldPath, status: "untracked", staged: false });
        continue;
      }

      // Conflict markers (U, AA, DD, AU, UA, DU, UD, UU) — single conflicted
      // entry. Previously these emitted two records (conflicted + a bogus
      // "modified" unstaged twin); now they appear once in the conflicts group.
      if (
        indexStatus === "U" ||
        workTreeStatus === "U" ||
        (indexStatus === "A" && workTreeStatus === "A") ||
        (indexStatus === "D" && workTreeStatus === "D")
      ) {
        files.push({ path: filePath, oldPath, status: "conflicted", staged: false });
        continue;
      }

      // Emit one entry per side that actually has a change. Each entry's status
      // is derived from its own code, so a staged-add-then-edited file shows
      // A in Staged and M in Changes (correct), instead of both being forced
      // to a single blended/modified value.
      const isStaged =
        indexStatus !== " " && indexStatus !== "?" && indexStatus !== "!";
      const hasUnstaged =
        workTreeStatus !== " " &&
        workTreeStatus !== "?" &&
        workTreeStatus !== "!";

      if (isStaged) {
        files.push({
          path: filePath,
          oldPath,
          status: codeToStatus(indexStatus),
          staged: true,
        });
      }
      if (hasUnstaged) {
        files.push({
          path: filePath,
          oldPath,
          status: codeToStatus(workTreeStatus),
          staged: false,
        });
      }
    }
    this.statusCache.set("wtChanges", files);
    return files;
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await this.execGit(["add", "--", ...filePaths]);
    // stage/unstage 改写 .git/index，必须同步失效 statusCache：index 的
    // lockfile+rename 写入在部分平台漏报 FS watcher 事件（见 setupGit 聚焦
    // 广播注释），漏报时 1.5s TTL 内会返回旧的 working tree 状态。
    // 只清 statusCache：refs 没动，log/branches/tags 缓存仍然有效。
    this.invalidateStatusCache();
  }

  /**
   * HEAD 是否可解析。仓库还没有任何 commit（unborn 分支）时返回 false。
   * 这种状态下 `git reset HEAD` 会因 HEAD 不存在而失败。
   */
  private async hasHead(): Promise<boolean> {
    try {
      await this.execGit(["rev-parse", "--verify", "-q", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async unstageFile(filePath: string): Promise<void> {
    if (await this.hasHead()) {
      await this.execGit(["reset", "HEAD", "--", filePath]);
    } else {
      // unborn 分支：所有暂存文件都是新文件，rm --cached 等价于 reset HEAD 对新文件的效果
      await this.execGit(["rm", "--cached", "--ignore-unmatch", "--", filePath]);
    }
    // stage/unstage 也只失效 statusCache（理由同 stageFiles，refs 未动）。
    this.invalidateStatusCache();
  }

  async unstageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }
    if (await this.hasHead()) {
      await this.execGit(["reset", "HEAD", "--", ...filePaths]);
    } else {
      await this.execGit(["rm", "--cached", "--ignore-unmatch", "--", ...filePaths]);
    }
    // stage/unstage 也只失效 statusCache（理由同 stageFiles，refs 未动）。
    this.invalidateStatusCache();
  }

  async unstageAll(): Promise<void> {
    if (await this.hasHead()) {
      await this.execGit(["reset", "HEAD"]);
    } else {
      // unborn 分支：清空 index 中所有暂存文件；--ignore-unmatch 避免 index 为空时报错
      await this.execGit(["rm", "-r", "--cached", "--ignore-unmatch", "."]);
    }
    // stage/unstage 也只失效 statusCache（理由同 stageFiles，refs 未动）。
    this.invalidateStatusCache();
  }

  async stageAll(): Promise<void> {
    await this.execGit(["add", "-A"]);
    // 理由同 stageFiles。
    this.invalidateStatusCache();
  }

  async commit(message: string, amend = false): Promise<void> {
    const args = ["commit", "-m", message];
    if (amend) args.push("--amend");
    await this.execGit(args);
    this.invalidateCache();
  }

  async commitAndPush(message: string, amend = false): Promise<void> {
    await this.commit(message, amend);
    // Push current branch
    const branch = await this.getCurrentBranch();
    if (branch) {
      const force = amend;
      await this.push(branch, force);
    }
  }

  /**
   * Commit ONLY the given pathspecs' working-tree state, ignoring other
   * staged content. `git commit -m msg -- <paths>`. 返回新提交的 hash。
   *
   * On an unborn branch (no commits yet) the same command creates the root
   * commit with just these paths — no parent to resolve, so no special case.
   */
  async commitPaths(message: string, paths: string[]): Promise<string> {
    if (paths.length === 0) {
      throw new Error("commitPaths requires at least one path");
    }

    await this.execGit(["commit", "-m", message, "--", ...paths]);
    // Same post-commit side effect as commit()
    this.invalidateCache();

    // Resolve the newly created commit's hash
    const hash = (await this.execGit(["rev-parse", "HEAD"])).trim();
    return hash;
  }

  async getCurrentBranch(): Promise<string | null> {
    try {
      const output = await this.execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = output.trim();
      return branch === "HEAD" ? null : branch;
    } catch {
      return null;
    }
  }

  /**
   * Whether the repository has any configured remote (`git remote` non-empty).
   * Used to gate push-related UI ("Commit and Push") and to short-circuit a
   * push attempt that would otherwise surface an ugly `git push` error.
   */
  async hasRemote(): Promise<boolean> {
    // Config-derived quasi-static data: remotes only change via
    // .git/config edits (gitWatcher → invalidateConfigCache, plus explicit
    // invalidation after addRemote/removeRemote/setRemoteUrl/renameRemote).
    // Cached instead of spawning `git remote` on every badge refresh /
    // event window / focus tick. Failure results are NOT cached.
    const cached = this.configCache.get<boolean>("hasRemote");
    if (cached !== undefined) return cached;
    try {
      const output = await this.execGit(["remote"]);
      const result = output.trim().length > 0;
      this.configCache.set("hasRemote", result);
      return result;
    } catch {
      return false;
    }
  }

  /**
   * Get the default remote for the current branch.
   * Tries the upstream tracking remote first, then falls back to the first configured remote.
   */
  async getDefaultRemote(branch?: string): Promise<string> {
    // Try to get the upstream remote for the given branch
    if (branch) {
      try {
        const output = await this.execGit([
          "config",
          `branch.${branch}.remote`,
        ]);
        const remote = output.trim();
        if (remote) return remote;
      } catch {
        // No upstream configured
      }
    }

    // Fall back to first configured remote
    try {
      const output = await this.execGit(["remote"]);
      const remotes = output
        .trim()
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);
      if (remotes.length > 0) {
        // Prefer "origin" if it exists, otherwise first remote
        return remotes.includes("origin") ? "origin" : remotes[0];
      }
    } catch {
      // ignore
    }

    return "origin";
  }

  /**
   * Get the URL configured for a remote via `git remote get-url`.
   * Returns "" when the remote is unknown or has no URL.
   */
  async getRemoteUrl(remote: string): Promise<string> {
    try {
      const output = await this.execGit(["remote", "get-url", remote]);
      return output.trim();
    } catch {
      return "";
    }
  }

  /**
   * List all configured remotes via `git remote -v`.
   * Parses the "(fetch)" lines (`name\turl (fetch)`) and dedupes by name —
   * each remote appears twice in `-v` output (fetch + push) with the same
   * name, so first-wins dedupe keeps a single { name, url } entry per remote.
   */
  async getRemotes(): Promise<Array<{ name: string; url: string }>> {
    // Config-derived quasi-static data (see hasRemote) — cached instead of
    // re-running `git remote -v` on every panel fetchInitialData round.
    const cached = this.configCache.get<Array<{ name: string; url: string }>>(
      "remotes",
    );
    if (cached) return cached;
    try {
      const output = await this.execGit(["remote", "-v"]);
      const seen = new Set<string>();
      const remotes: Array<{ name: string; url: string }> = [];
      for (const line of output.trim().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.endsWith("(fetch)")) continue;
        const match = /^(.+?)\t(.+)\s+\(fetch\)$/.exec(trimmed);
        if (!match) continue;
        const [, name, url] = match;
        if (name && url && !seen.has(name)) {
          seen.add(name);
          remotes.push({ name, url });
        }
      }
      this.configCache.set("remotes", remotes);
      return remotes;
    } catch {
      return [];
    }
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.execGit(["remote", "add", name, url]);
    this.invalidateConfigCache();
  }

  async removeRemote(name: string): Promise<void> {
    await this.execGit(["remote", "remove", name]);
    this.invalidateConfigCache();
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.execGit(["remote", "set-url", name, url]);
    this.invalidateConfigCache();
  }

  async renameRemote(name: string, newName: string): Promise<void> {
    await this.execGit(["remote", "rename", name, newName]);
    this.invalidateConfigCache();
  }

  async getLastCommitMessage(): Promise<string> {
    try {
      const output = await this.execGit(["log", "-1", "--format=%B"]);
      return output.trim();
    } catch {
      return "";
    }
  }

  async getRecentCommitMessages(count = 20): Promise<string[]> {
    try {
      const output = await this.execGit(["log", `-${count}`, "--format=%s"]);
      return output
        .trim()
        .split("\n")
        .filter((msg) => msg.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Group-aware rollback: reverts only ONE side of a file's changes based on
   * which list the action originated from.
   *
   * - staged=true  (from the Staged group):  `git reset HEAD -- <path>` —
   *   unstages the file (index → HEAD) and leaves the working tree untouched.
   * - staged=false (from the Changes group): `git checkout -- <path>` —
   *   restores the working tree to the index (staged) version, preserving any
   *   staged edits. This is the fix for "stage a file, edit it again, then
   *   rollback from Changes": only the unstaged edits are discarded.
   *   A truly untracked file (not in the index) has no staged version to
   *   restore, so it is deleted — mirroring VSCode's native "Discard Changes"
   *   on an untracked file.
   *
   * For a full revert of BOTH sides (the standalone Rollback panel), use
   * rollbackFileToHead instead.
   */
  async rollbackFile(filePath: string, staged = false): Promise<void> {
    if (staged) {
      await this.execGit(["reset", "HEAD", "--", filePath]);
      return;
    }
    // Unstaged: restore working tree to the index version. If the path is not
    // in the index (untracked), there is nothing to restore — delete it.
    let inIndex = false;
    try {
      await this.execGit(["ls-files", "--error-unmatch", "--", filePath]);
      inIndex = true;
    } catch {
      inIndex = false;
    }
    if (inIndex) {
      await this.execGit(["checkout", "--", filePath]);
    } else {
      const fullPath = path.join(this.cwd, filePath);
      try {
        await fs.unlink(fullPath);
      } catch (err: unknown) {
        // Only tolerate "file already gone" — surface real failures (locked
        // on Windows: EPERM/EBUSY, permission: EACCES) so the caller reports
        // them instead of a false success.
        const code = (err as { code?: string }).code;
        if (code !== "ENOENT") throw err;
      }
    }
  }

  /**
   * Fully revert a file to its HEAD version — discards BOTH index (staged)
   * and working-tree (unstaged) changes. Used by the standalone Rollback
   * panel (executeRollback), which is a "discard everything" entry distinct
   * from the group-aware rollbackFile that reverts one side at a time.
   */
  async rollbackFileToHead(filePath: string): Promise<void> {
    let existsInHead = false;
    try {
      await this.execGit(["cat-file", "-e", `HEAD:${filePath}`]);
      existsInHead = true;
    } catch {
      existsInHead = false;
    }

    if (existsInHead) {
      await this.execGit(["checkout", "HEAD", "--", filePath]);
    } else {
      // File is new (not in HEAD) - remove from index and delete from disk
      try {
        await this.execGit(["rm", "-f", "--cached", "--", filePath]);
      } catch {
        // Not in index either, nothing to unstage
      }
      const fullPath = path.join(this.cwd, filePath);
      try {
        await fs.unlink(fullPath);
      } catch {
        // File already doesn't exist on disk
      }
    }
  }

  // ─── Stash Operations ───────────────────────────────────────────

  /**
   * 将 stash 的完整 SHA 解析为执行瞬间的 reflog 引用形式（stash@{n}）。
   *
   * 为什么需要解析：git 的 `stash pop` / `stash drop` 只接受 stash 引用形式
   * （stash@{n}），传入裸 SHA 会报
   * `error: '...' is not a stash reference`（实测 git 2.50.1）；而
   * `stash apply` / `stash show` / `checkout <sha> -- <path>` 均接受裸 SHA。
   * 因此协议层的 SHA 寻址（稳定标识，不随栈漂移）在执行 pop/drop 前必须
   * 换算成 stash@{n}。
   *
   * 解析方式：`git stash list --format=%H` 按栈序枚举，第 n 行即 stash@{n}，
   * 按完整 SHA 精确匹配行号。匹配在执行瞬间进行且按 SHA 做恒等判定，不会
   * 命中错误条目 —— SHA 防漂移语义不变；条目已不在栈中（找不到匹配行）则
   * 抛错冒泡给调用方。
   *
   * execGit 是 execFile 数组传参，`stash@{0}` 字符串不经 shell，无解释风险。
   *
   * 已是引用形式（stash@{...}）的入参直接透传（dropCommit 的降级路径）。
   */
  private async resolveStashRefForm(ref: string): Promise<string> {
    if (ref.startsWith("stash@{")) {
      return ref;
    }
    const output = await this.execGit(["stash", "list", "--format=%H"]);
    const shas = output.trim().split("\n").filter(Boolean);
    const index = shas.indexOf(ref);
    if (index === -1) {
      throw new Error(vscode.l10n.t("Stash entry no longer exists."));
    }
    return `stash@{${index}}`;
  }

  async getStashes(): Promise<import("./types").StashEntry[]> {
    // Invalidation: stash push/pop/drop call the full invalidateCache;
    // external terminal stashes rewrite .git/index, which the watcher maps
    // to invalidateStatusCache (stashCache follows the index tier);
    // window-focus fallback clears everything.
    const cached = this.stashCache.get<import("./types").StashEntry[]>(
      "stashes",
    );
    if (cached) return cached;
    // 不再用外层 try-catch 吞掉所有 git 错误并返回 [] —— 那会让真实 git 故障
    //（例如仓库损坏、git 可执行文件丢失）对调用方完全不可见。让 execGit 的错误
    // 自然冒泡，由 handler/router 路由到 webview。
    // %H 完整 SHA 作为稳定标识（stash@{n} 会随栈变化漂移，仅用于显示）。
    const output = await this.execGit([
      "stash",
      "list",
      "--format=%H%x00%gd%x00%s%x00%aI%x00%D",
    ]);
    if (!output.trim()) {
      this.stashCache.set("stashes", []);
      return [];
    }

    const entries: import("./types").StashEntry[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\x00");
      const sha = parts[0] ?? "";
      const id = parts[1] ?? "";
      const subject = parts[2] ?? "";
      const message = subject.replace(/^(WIP on|On) [^:]+:\s*/, "");
      const date = parts[3] ?? "";
      const _refs = parts[4] ?? "";
      // Extract branch from refs or message
      const branchMatch = subject.match(/^(?:WIP on|On) ([^:]+)/);
      const branch = branchMatch?.[1] ?? "";

      entries.push({ sha, id, message, date, branch, files: [] });
    }

    // Load files for each stash
    // 内层 try-catch 保留：单个 stash 的 file list 解析失败属于可降级场景，
    // 不应影响整体返回（files 字段保持为空数组即可）。
    // Promise.all 并发执行各 stash 的 `git stash show`：串行会对 N 个
    // stash 连续跑 N 个子进程，并发合并为一批完成。
    // --include-untracked 让未跟踪文件也出现在列表中（git 2.32+）；
    // 旧版 git 不支持该 flag 时回退为不带 flag 重试。
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const filesOutput = await this.execGit([
            "stash",
            "show",
            entry.sha,
            "--name-only",
            "--include-untracked",
          ]);
          entry.files = filesOutput
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(unquoteGitPath);
          } catch {
            try {
              const filesOutput = await this.execGit([
                "stash",
                "show",
                entry.sha,
                "--name-only",
              ]);
              entry.files = filesOutput
                .trim()
                .split("\n")
                .filter(Boolean)
                .map(unquoteGitPath);
              // 旧 git 的 show 不含未跟踪文件：纯 untracked 贮藏 files 会
              // 为空、导致无法单文件恢复。用第三父提交（^3）兜底补齐；
              // 贮藏无 ^3 时 ls-tree 抛错，静默忽略。
              try {
                const untrackedOutput = await this.execGit([
                  "ls-tree",
                  "-r",
                  "--name-only",
                  `${entry.sha}^3`,
                ]);
                const untracked = untrackedOutput
                  .trim()
                  .split("\n")
                  .filter(Boolean)
                  .map(unquoteGitPath);
                entry.files = [...new Set([...entry.files, ...untracked])];
              } catch {
                // 无 ^3 父提交（贮藏未包含未跟踪文件），忽略
              }
            } catch {
              // 单个 stash 的 file list 解析失败，忽略，files 保持为 []
            }
          }
      }),
    );

    this.stashCache.set("stashes", entries);
    return entries;
  }

  /**
   * 贮藏改动。filePaths 为 undefined 时全量贮藏（含未跟踪文件）；指定
   * 路径列表时按路径贮藏全部改动；stagedOnly 为 true 时仅贮藏指定路径中
   * 已暂存的部分（需 git 2.35+ 的 --staged，旧版 git 明确报错而非降级）。
   */
  async stashChanges(
    message: string,
    filePaths?: string[],
    stagedOnly = false,
  ): Promise<void> {
    // 空数组防护：显式传入空列表视为误用，直接 no-op 返回。
    // 全量贮藏必须显式传 undefined（不传 filePaths），避免调用侧
    // 语义混淆 —— 空列表 ≠ 全量。
    if (filePaths && filePaths.length === 0) {
      return;
    }
    if (stagedOnly && filePaths && filePaths.length > 0) {
      // 仅贮藏指定路径的已暂存部分：--staged 创建的 stash 只含 index 改动。
      // 旧 git（<2.35）不识别 --staged（报 unknown option）—— 不降级重试：
      // 按路径全量贮藏会静默收走未暂存改动、违背「仅暂存」的范围承诺，
      // 明确报错让用户升级 git 或改选范围。其余失败（needs merge、
      // index.lock 竞争等）原样冒泡。execGit 固定 LC_ALL=C，错误文案可
      // 稳定匹配。
      try {
        await this.execGit([
          "stash",
          "push",
          "--staged",
          "-m",
          message || "Stashed changes",
          "--",
          ...filePaths,
        ]);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (/unknown option/i.test(detail)) {
          throw new Error(
            vscode.l10n.t(
              "Stashing only staged changes requires Git 2.35 or newer. Please upgrade Git or choose a different stash scope.",
            ),
          );
        }
        throw err;
      }
    } else if (filePaths && filePaths.length > 0) {
      // git 2.13+ 原生支持 `git stash push -- <pathspec>`，一步完成对指定文件的
      // stash（同时包含 index 与 working tree 的改动，--include-untracked 也覆盖
      // 未跟踪文件）。相比旧实现（reset HEAD → add targets → stash --staged →
      // 重新 add 剩余文件）少 4 个中间步骤，从根本上消除"中间步骤失败导致 staged
      // 状态被破坏"的污染场景。
      // 行为变化：旧实现只 stash 目标 path 的 staged 部分，unstaged 部分留在工作区
      // （这反而与"stash 这些文件"的 UI 承诺不符，属于隐 bug）；新实现 stash 目标
      // path 的全部改动（staged + unstaged + untracked）。
      await this.execGit([
        "stash",
        "push",
        "--include-untracked",
        "-m",
        message || "Stashed changes",
        "--",
        ...filePaths,
      ]);
    } else {
      // Stash all changes including untracked
      const args = ["stash", "push", "-m", message || "Stashed changes", "-u"];
      await this.execGit(args);
    }
    this.invalidateCache();
  }

  /**
   * 指定文件是否存在未提交改动（staged 或 unstaged）。用于覆盖类操作
   * （如从 stash 检出单文件到工作区）前的确认判断。
   */
  async hasUncommittedFileChanges(filePath: string): Promise<boolean> {
    const output = await this.execGit([
      "status",
      "--porcelain",
      "--",
      filePath,
    ]);
    return output.trim().length > 0;
  }

  async unstashChanges(stashRef: string, drop = true): Promise<void> {
    try {
      // apply 用完整 SHA 寻址，不受 stash@{n} 栈重排影响；pop 拆为
      // apply+drop，把 TOCTOU 窗口收窄到 apply 与 drop 之间且方向安全
      //（中断最多多保留一条条目，不会弹出错误条目）。apply 冲突时 git
      // 已改写工作区后抛错、不会 drop —— 与 pop 语义一致。
      await this.execGit(["stash", "apply", stashRef]);
      if (drop) {
        // drop 只接受 stash@{n} 引用形式，执行前由 SHA 重新解析
        //（条目已不在栈中则抛错冒泡）。
        await this.execGit([
          "stash",
          "drop",
          await this.resolveStashRefForm(stashRef),
        ]);
      }
    } finally {
      // apply 冲突时 git 已把冲突标记写入工作区但命令以非零退出 —— 必须
      // 失效缓存，否则状态/贮藏缓存停留在旧数据。
      this.invalidateCache();
    }
  }

  async deleteStash(stashRef: string): Promise<void> {
    // drop 同样只接受 stash@{n} 引用形式，先由 SHA 解析。
    await this.execGit([
      "stash",
      "drop",
      await this.resolveStashRefForm(stashRef),
    ]);
    // 与 stashChanges/unstashChanges 对齐：drop 改变了 stash 栈，
    // 需失效缓存让下一次 getStashes 拿到最新列表。
    this.invalidateCache();
  }

  public async generatePatchForFiles(filePaths: string[]): Promise<string> {
    let patch = "";

    // Separate tracked and untracked files
    const tracked: string[] = [];
    const untracked: string[] = [];

    for (const filePath of filePaths) {
      try {
        await this.execGit(["ls-files", "--error-unmatch", filePath]);
        tracked.push(filePath);
      } catch {
        untracked.push(filePath);
      }
    }

    // Generate diff for tracked files (staged + unstaged)
    if (tracked.length > 0) {
      try {
        const diff = await this.execGit(["diff", "HEAD", "--", ...tracked]);
        patch += diff;
      } catch {
        // If HEAD doesn't exist (initial commit), diff against empty tree
        try {
          const diff = await this.execGit([
            "diff",
            "--cached",
            "--",
            ...tracked,
          ]);
          patch += diff;
        } catch {
          // ignore
        }
      }
    }

    // Generate patch for untracked files
    for (const filePath of untracked) {
      const fullPath = path.join(this.cwd, filePath);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        patch += `diff --git a/${filePath} b/${filePath}\n`;
        patch += "new file mode 100644\n";
        patch += "--- /dev/null\n";
        patch += `+++ b/${filePath}\n`;
        patch += `@@ -0,0 +1,${lines.length} @@\n`;
        for (const line of lines) {
          patch += `+${line}\n`;
        }
      } catch {
        // skip files that can't be read
      }
    }

    return patch;
  }

  public async generatePatchAll(): Promise<string> {
    let patch = "";

    // Get diff for all tracked changes
    try {
      const diff = await this.execGit(["diff", "HEAD"]);
      patch += diff;
    } catch {
      try {
        const diff = await this.execGit(["diff", "--cached"]);
        patch += diff;
      } catch {
        // ignore
      }
    }

    // Get untracked files
    try {
      const untrackedOutput = await this.execGit([
        "ls-files",
        "--others",
        "--exclude-standard",
      ]);
      const untrackedFiles = untrackedOutput
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(unquoteGitPath);

      for (const filePath of untrackedFiles) {
        const fullPath = path.join(this.cwd, filePath);
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          patch += `diff --git a/${filePath} b/${filePath}\n`;
          patch += "new file mode 100644\n";
          patch += "--- /dev/null\n";
          patch += `+++ b/${filePath}\n`;
          patch += `@@ -0,0 +1,${lines.length} @@\n`;
          for (const line of lines) {
            patch += `+${line}\n`;
          }
        } catch {
          // skip binary or unreadable files
        }
      }
    } catch {
      // ignore
    }

    return patch;
  }

  /**
   * Full invalidation: refs-level state change (HEAD/branches/tags moved,
   * external-change fallback, refresh-all). Clears everything, including
   * config-derived caches.
   */
  invalidateCache(pattern?: string): void {
    this.cache.invalidate(pattern);
    // statusCache/stashCache 只有整体键，无需 pattern 精确失效，一并清空。
    this.statusCache.invalidate();
    this.stashCache.invalidate();
    this.configCache.invalidate();
  }

  /**
   * Index-level invalidation only: the working tree changed (file save,
   * stage/unstage, external stash) but no refs moved. Log/branches/tags are
   * functions of the refs alone and remain valid — dropping them here would
   * force a full `git log --all` re-run on the next panel refresh for
   * nothing. Stash entries follow the index tier (stash push rewrites
   * .git/index).
   */
  invalidateStatusCache(): void {
    this.statusCache.invalidate();
    this.stashCache.invalidate();
  }

  /**
   * Config-level invalidation only: .git/config changed (remotes edited,
   * identity reconfigured). Ref-derived caches stay valid.
   */
  invalidateConfigCache(): void {
    this.configCache.invalidate();
  }
}

function parseDiffNameStatus(output: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of output.trim().split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\t");
    const statusCode = parts[0]?.trim() ?? "";

    if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
      const oldPath = unquoteGitPath(parts[1] ?? "");
      const newPath = unquoteGitPath(parts[2] ?? "");
      files.push({
        oldPath,
        newPath,
        status: statusCode.startsWith("R") ? "renamed" : "copied",
        isBinary: false,
      });
    } else {
      const filePath = unquoteGitPath(parts[1] ?? "");
      let status: DiffFile["status"] = "modified";
      if (statusCode === "A") {
        status = "added";
      } else if (statusCode === "D") {
        status = "deleted";
      }
      files.push({
        oldPath: filePath,
        newPath: filePath,
        status,
        isBinary: false,
      });
    }
  }
  return files;
}

/**
 * git 在非 `-z` 格式下（status --porcelain / diff-tree --name-status /
 * ls-files / diff --name-only 等），只要路径包含空格、引号、反斜杠、控制字符，
 * 或 core.quotepath=true 时包含非 ASCII 字符，就会输出 C 风格双引号包裹并转义
 * 的路径，例如 "Cowork Helper/Cowork Helper.js" 或 "\344\270\255\346\226\207.js"。
 * 本函数剥离包裹引号并解码转义序列，还原真实路径。未加引号的路径原样返回。
 */
function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  const inner = raw.slice(1, -1);
  if (!inner.includes("\\")) {
    return inner;
  }

  let result = "";
  // 连续的八进制转义先攒成字节，再按 UTF-8 解码（core.quotepath=true 时
  // 非 ASCII 字符被逐字节转义，必须整体解码才能还原）。
  let pendingBytes: number[] = [];
  const flushBytes = () => {
    if (pendingBytes.length > 0) {
      result += Buffer.from(pendingBytes).toString("utf-8");
      pendingBytes = [];
    }
  };

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== "\\") {
      flushBytes();
      result += ch;
      continue;
    }
    i++;
    const esc = inner[i];
    switch (esc) {
      case "\\":
        flushBytes();
        result += "\\";
        break;
      case '"':
        flushBytes();
        result += '"';
        break;
      case "n":
        flushBytes();
        result += "\n";
        break;
      case "t":
        flushBytes();
        result += "\t";
        break;
      case "r":
        flushBytes();
        result += "\r";
        break;
      case undefined:
        break;
      default: {
        if (esc >= "0" && esc <= "7") {
          let oct = esc;
          while (
            i + 1 < inner.length &&
            oct.length < 3 &&
            inner[i + 1]! >= "0" &&
            inner[i + 1]! <= "7"
          ) {
            oct += inner[++i]!;
          }
          pendingBytes.push(parseInt(oct, 8) & 0xff);
        } else {
          flushBytes();
          result += esc;
        }
      }
    }
  }
  flushBytes();
  return result;
}

/**
 * Whether `ref` can address a stash's `^3` untracked-file parent.
 * Accepts hex object names (7-64 chars, covering SHA-256 repos) and
 * stash refs (`stash`, `stash@{0}`, …). Index stages (`:0`…), `HEAD`,
 * and the `empty` sentinel never match; a branch name starting with
 * "stash" also matches, costing only one failed `git show`.
 */
function canHaveStashUntrackedParent(ref: string): boolean {
  if (ref.startsWith("stash")) {
    return true;
  }
  return /^[0-9a-f]{7,64}$/i.test(ref);
}

function parseLogOutput(output: string): CommitNode[] {
  const commits: CommitNode[] = [];
  const records = output.split(RECORD_SEP);

  for (const record of records) {
    const trimmed = record.trim();
    if (!trimmed) {
      continue;
    }
    const fields = trimmed.split(FIELD_SEP);
    if (fields.length < 9) {
      continue;
    }

    const refsStr = fields[8]?.trim() ?? "";
    const refs = parseRefs(refsStr);

    commits.push({
      hash: fields[0] ?? "",
      shortHash: fields[1] ?? "",
      parents: (fields[2] ?? "").split(" ").filter((s) => s.length > 0),
      authorName: fields[3] ?? "",
      authorEmail: fields[4] ?? "",
      authorDate: fields[5] ?? "",
      subject: fields[6] ?? "",
      body: fields[7] ?? "",
      refs,
    });
  }
  return commits;
}

function parseRefs(refsStr: string): RefInfo[] {
  if (!refsStr) {
    return [];
  }
  const refs: RefInfo[] = [];
  const parts = refsStr.split(",").map((s) => s.trim());

  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (part === "HEAD") {
      refs.push({ type: "HEAD", name: "HEAD" });
    } else if (part.startsWith("HEAD -> ")) {
      refs.push({ type: "HEAD", name: "HEAD" });
      refs.push({ type: "branch", name: part.replace("HEAD -> ", "") });
    } else if (part.startsWith("tag: ")) {
      refs.push({ type: "tag", name: part.replace("tag: ", "") });
    } else if (part.includes("/")) {
      // Distinguish remote branches from local branches with slashes (e.g. feat/xxx)
      // Remote branches in %D format are prefixed with remote name (origin/, upstream/, etc.)
      // Common pattern: if first segment before / is a short name (likely a remote), treat as remote
      const firstSlash = part.indexOf("/");
      const prefix = part.substring(0, firstSlash);
      // Heuristic: remote names are typically short (origin, upstream, fork, etc.)
      // Local branch names with / typically start with feat/, fix/, hotfix/, release/, etc.
      const localPrefixes = [
        "feat",
        "fix",
        "hotfix",
        "release",
        "bugfix",
        "feature",
        "chore",
        "docs",
        "refactor",
        "test",
        "ci",
        "build",
        "perf",
        "style",
        "revert",
        "wip",
        "dependabot",
      ];
      if (localPrefixes.includes(prefix.toLowerCase())) {
        refs.push({ type: "branch", name: part });
      } else {
        refs.push({ type: "remote-branch", name: part });
      }
    } else {
      refs.push({ type: "branch", name: part });
    }
  }
  return refs;
}

function parseTrack(track: string): { ahead: number; behind: number } {
  let ahead = 0;
  let behind = 0;
  const aheadMatch = track.match(/ahead (\d+)/);
  if (aheadMatch) {
    ahead = parseInt(aheadMatch[1], 10);
  }
  const behindMatch = track.match(/behind (\d+)/);
  if (behindMatch) {
    behind = parseInt(behindMatch[1], 10);
  }
  return { ahead, behind };
}

/**
 * Initialize a new git repository at `targetPath` (runs `git init`).
 *
 * 作为独立的导出函数(而非 GitService 实例方法)存在:目标目录此时还不是 git
 * 仓库、没有 GitService 实例可调用。幂等 —— 对已存在的仓库重新 init 时 git
 * 退出码为 0,等价于 no-op。复用 GitService.execGit 相同的环境加固(LC_ALL、
 * 禁用终端提示)。
 */
export async function initGitRepo(targetPath: string): Promise<void> {
  await execFileAsync("git", ["init"], {
    cwd: targetPath,
    maxBuffer: MAX_BUFFER,
    env: {
      ...process.env,
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}
