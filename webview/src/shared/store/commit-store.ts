import { create } from "zustand";
import { bridge } from "../bridge";
import { t } from "../i18n";
import type { RepoInfo, RepoStatus } from "../types/git";

export interface WorkingTreeFile {
  path: string;
  oldPath?: string;
  status:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "untracked"
    | "conflicted";
  staged: boolean;
}

export interface StashEntry {
  id: string;
  message: string;
  date: string;
  branch: string;
  files: string[];
}

type TabType = "commit" | "stash";

interface CommitStore {
  // ── Multi-repo (phase B') ──────────────────────────────────────────
  /** Active repo path. Null until the ready handshake (initRepo) resolves. */
  currentRepoPath: string | null;
  /** All known repos (drives RepoSelector rendering). */
  repos: RepoInfo[];
  /**
   * Monotonic counter bumped on every switchRepo / repoChanged. Every fetch
   * captures its own `mySeq` at issue time and, after the await, drops its
   * result when `mySeq !== get().repoSeq` — the in-flight race guard
   * (oracle hard constraint #3): bridge has no cancellation, so a slow
   * getWorkingTreeChanges for repo A can resolve AFTER the user switched to
   * repo B and would otherwise overwrite repo B's changes with repo A's.
   */
  repoSeq: number;
  /**
   * Monotonic counter bumped every time commit / commitAndPush clears the
   * commit message (and on repoChanged). Long-running async producers that
   * write back into commitMessage (AI generate, amend load) capture this value
   * before awaiting and, after the await, drop their result when it changed —
   * i.e. a commit landed in the meantime. Without this, an AI request
   * resolving after a successful commit would re-fill the textarea with the
   * just-committed message.
   */
  commitEpoch: number;
  /**
   * Per-repo ahead/behind/dirty counts keyed by normalized repo path, backing
   * the RepoSelector chip badges. Refreshed by fetchRepoStatuses on init,
   * repoChanged, and every gitStateChanged.
   */
  repoStatuses: Record<string, RepoStatus>;

  // File changes
  changes: WorkingTreeFile[];
  selectedFiles: Set<string>;
  /** Files highlighted via click/Cmd+click (for context menu operations) */
  highlightedFiles: Set<string>;

  // Commit state
  commitMessage: string;
  amend: boolean;

  // Stash
  stashes: StashEntry[];

  // UI state
  activeTab: TabType;
  loading: boolean;
  expandedGroups: Set<string>;
  groupByDirectory: boolean;
  showUnversioned: boolean;
  /** Collapsed directory paths in tree view */
  collapsedDirs: Set<string>;

  // List style (VSCode / JetBrains)
  commitListStyle: "vscode" | "jetbrains";
  // Badge display mode (Total commits / Current repo / Off)
  commitBadgeMode: "total" | "current" | "off";
  /** 提交并推送时是否跳过推送确认面板直接推送。 */
  skipPushConfirmation: boolean;
  // AI commit message 生成
  aiGenerating: boolean;
  /** 用户已请求取消当前生成（generateCommitMessage 的 catch 据此跳过错误提示）。 */
  aiCancelling: boolean;
  aiConfigured: boolean;
  aiApiUrl: string;
  aiModel: string;
  aiTimeout: number;
  fetchGitConfig: () => Promise<void>;
  fetchAiConfig: () => Promise<void>;
  generateCommitMessage: () => Promise<void>;
  /** 取消进行中的 AI 生成。 */
  cancelCommitMessage: () => Promise<void>;
  setCommitListStyle: (style: "vscode" | "jetbrains") => Promise<void>;
  setCommitBadgeMode: (mode: "total" | "current" | "off") => Promise<void>;
  /** Discard (rollback) multiple files; backend handler already confirms modally. */
  rollbackFiles: (filePaths: string[]) => Promise<void>;

  // ── Multi-repo actions ─────────────────────────────────────────────
  /** Switch the active repo. Only issues the host command; the repoChanged
   *  event drives the actual state mutation + refetch (no optimistic update). */
  switchRepo: (path: string) => Promise<void>;
  /** Pull the latest repo list from the host. */
  fetchRepos: () => Promise<void>;
  /** Ready handshake: getCurrentRepo + getRepos + first fetch. Called once on mount. */
  initRepo: () => Promise<void>;
  /** Fetch ahead/behind/dirty counts for every repo (drives the chip badges). */
  fetchRepoStatuses: () => Promise<void>;

  // Actions
  fetchChanges: () => Promise<void>;
  fetchStashes: () => Promise<void>;
  setCommitMessage: (msg: string) => void;
  /** 从 host 读取当前 repo 的草稿并回填（不走持久化，避免回写）。 */
  loadCommitDraft: () => Promise<void>;
  setAmend: (amend: boolean) => void;
  toggleFileSelection: (filePath: string) => void;
  setFileKeys: (keys: string[], selected: boolean) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  highlightFile: (key: string, mode: "single" | "toggle") => void;
  stageFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  stageFiles: (filePaths: string[]) => Promise<void>;
  unstageFiles: (filePaths: string[]) => Promise<void>;
  commit: () => Promise<boolean>;
  commitAndPush: () => Promise<boolean>;
  rollbackFile: (filePath: string) => Promise<void>;
  showDiff: (filePath: string, staged?: boolean) => Promise<void>;
  stashChanges: (message?: string, filePaths?: string[]) => Promise<void>;
  unstashChanges: (stashId: string, drop?: boolean) => Promise<void>;
  deleteStash: (stashId: string) => Promise<void>;
  setActiveTab: (tab: TabType) => void;
  toggleGroup: (group: string) => void;
  toggleDir: (dirPath: string) => void;
  expandAllDirs: () => void;
  collapseAllDirs: (allDirPaths: string[]) => void;
  toggleGroupByDirectory: () => void;
  toggleShowUnversioned: () => void;
  refresh: () => Promise<void>;
}

/**
 * 提交信息草稿的持久化辅助（项目级、多 repo）。
 *
 * - scheduleDraftSave：防抖写入（用户连续输入时合并，400ms 静默后落盘）。
 * - flushDraftSave：立即落盘并取消未到期的防抖（用于 repo 切换前 / 提交成功清空）。
 * repoPath 为 null（无活动仓库）时不操作。
 */
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDraftSave(repoPath: string | null, message: string): void {
  if (!repoPath) return;
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    void bridge.request("saveCommitDraft", { repoPath, message }).catch(() => {});
  }, 400);
}

function flushDraftSave(repoPath: string | null, message: string): void {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  if (!repoPath) return;
  void bridge.request("saveCommitDraft", { repoPath, message }).catch(() => {});
}

export const useCommitStore = create<CommitStore>((set, get) => ({
  // ── Multi-repo ─────────────────────────────────────────────────────
  currentRepoPath: null,
  repos: [],
  repoSeq: 0,
  commitEpoch: 0,
  repoStatuses: {},

  changes: [],
  selectedFiles: new Set<string>(),
  highlightedFiles: new Set<string>(),
  commitMessage: "",
  amend: false,
  stashes: [],
  activeTab: "commit",
  loading: false,
  expandedGroups: new Set(["changes", "unversioned", "staged"]),
  groupByDirectory: true,
  showUnversioned: true,
  collapsedDirs: new Set<string>(),
  commitListStyle: "vscode",
  commitBadgeMode: "total",
  /** 提交并推送时是否跳过推送确认面板直接推送（默认 true）。 */
  skipPushConfirmation: true,
  aiGenerating: false,
  aiCancelling: false,
  aiConfigured: false,
  aiApiUrl: "",
  aiModel: "",
  aiTimeout: 30,

  // ── Multi-repo actions ─────────────────────────────────────────────
  async switchRepo(path: string) {
    // Bump seq FIRST so every in-flight fetch for the old repo drops its
    // (possibly still-incoming) response. No optimistic currentRepoPath
    // update — the host broadcasts repoChanged, which the listener handles.
    set({ repoSeq: get().repoSeq + 1 });
    try {
      await bridge.request("switchRepo", { repoPath: path });
    } catch (err) {
      console.error("switchRepo failed:", err);
    }
    // host broadcasts repoChanged → listener mutates currentRepoPath + refetches.
  },

  async fetchRepos() {
    try {
      const result = (await bridge.request("getRepos")) as {
        repos?: RepoInfo[];
      };
      if (Array.isArray(result?.repos)) {
        set({ repos: result.repos });
      }
    } catch (err) {
      console.error("fetchRepos failed:", err);
    }
  },

  async initRepo() {
    // Ready handshake: webview creation timing is not guaranteed, so we must
    // NOT assume a default currentRepoPath. Query the host for the truth, then
    // kick off the first fetch against that repo.
    try {
      const current = (await bridge.request("getCurrentRepo")) as {
        repoPath: string | null;
      };
      const reposResult = (await bridge.request("getRepos")) as {
        repos?: RepoInfo[];
      };
      set({
        currentRepoPath: current?.repoPath ?? null,
        repos: Array.isArray(reposResult?.repos) ? reposResult.repos : [],
        repoSeq: get().repoSeq + 1,
      });
    } catch (err) {
      console.error("initRepo failed:", err);
    }
    // Run the changes/stashes fetch and the badge fetch concurrently so badge
    // counts don't wait on the (300ms min-display) changes round-trip.
    await Promise.all([
      get().refresh(),
      get().fetchRepoStatuses(),
      get().fetchGitConfig(),
      get().fetchAiConfig(),
      get().loadCommitDraft(),
    ]);
  },

  async fetchRepoStatuses() {
    // ★ Capture seq at issue time for the in-flight race guard (same rationale
    // as fetchChanges: a stale full-status response must not clobber a fresher
    // one that already settled).
    const mySeq = get().repoSeq;
    try {
      const result = (await bridge.request("getRepoStatuses")) as {
        statuses?: RepoStatus[];
      };
      if (mySeq !== get().repoSeq) return;
      if (Array.isArray(result?.statuses)) {
        const map: Record<string, RepoStatus> = {};
        for (const s of result.statuses) map[s.repoPath] = s;
        set({ repoStatuses: map });
      }
    } catch (err) {
      console.error("fetchRepoStatuses failed:", err);
    }
  },

  async fetchChanges() {
    // ★ Capture seq + repoPath at issue time for the in-flight race guard.
    const mySeq = get().repoSeq;
    const repoPath = get().currentRepoPath;
    set({ loading: true });
    const start = Date.now();
    try {
      const result = (await bridge.request("getWorkingTreeChanges", {
        repoPath,
      })) as WorkingTreeFile[];
      // ★ Race guard: a switch happened during the fetch → drop stale changes.
      if (mySeq !== get().repoSeq) return;
      if (Array.isArray(result)) {
        const newPaths = new Set(result.map((f) => `${f.path}:${f.staged}`));
        const { selectedFiles, changes } = get();
        if (changes.length === 0) {
          // First load — no auto-selection (user manually selects files)
          set({ changes: result, selectedFiles: new Set<string>() });
        } else {
          // Refresh — preserve user's selection state (only keep existing selections)
          const preserved = new Set<string>();
          for (const p of selectedFiles) {
            if (newPaths.has(p)) preserved.add(p);
          }
          set({ changes: result, selectedFiles: preserved });
        }
      }
    } catch (err) {
      console.error("fetchChanges failed:", err);
    } finally {
      // Ensure loading bar is visible for at least 300ms
      const elapsed = Date.now() - start;
      if (elapsed < 300) {
        await new Promise((r) => setTimeout(r, 300 - elapsed));
      }
      // ★ Only clear loading if we're still the active seq.
      if (mySeq === get().repoSeq) set({ loading: false });
    }
  },

  async fetchStashes() {
    // ★ Capture seq + repoPath at issue time for the in-flight race guard.
    const mySeq = get().repoSeq;
    const repoPath = get().currentRepoPath;
    try {
      const result = (await bridge.request("getStashes", {
        repoPath,
      })) as StashEntry[];
      // ★ Race guard: a switch happened during the fetch → drop stale stashes.
      if (mySeq !== get().repoSeq) return;
      if (Array.isArray(result)) {
        set({ stashes: result });
      }
    } catch (err) {
      console.error("fetchStashes failed:", err);
    }
  },

  setCommitMessage(msg: string) {
    set({ commitMessage: msg });
    scheduleDraftSave(get().currentRepoPath, msg);
  },

  async loadCommitDraft() {
    const repoPath = get().currentRepoPath;
    if (!repoPath) return;
    const mySeq = get().repoSeq;
    try {
      const result = (await bridge.request("getCommitDraft", { repoPath })) as {
        message?: string;
      };
      if (mySeq !== get().repoSeq) return; // 期间 repo 已切换，丢弃过期结果
      // 直接 set，不走 setCommitMessage（刚从缓存读出，无需回写）
      set({ commitMessage: result?.message ?? "" });
    } catch {
      // ignore
    }
  },

  setAmend(amend: boolean) {
    set({ amend });
    if (amend) {
      // Load last commit message
      const startEpoch = get().commitEpoch;
      void (async () => {
        try {
          const result = (await bridge.request("getAmendMessage", {
            repoPath: get().currentRepoPath,
          })) as { message: string };
          // Drop if a commit cleared the message while this was in flight.
          if (get().commitEpoch !== startEpoch) return;
          if (result?.message) {
            get().setCommitMessage(result.message);
          }
        } catch {
          // ignore
        }
      })();
    }
  },

  toggleFileSelection(key: string) {
    const { selectedFiles } = get();
    const next = new Set(selectedFiles);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    set({ selectedFiles: next });
  },

  setFileKeys(keys: string[], selected: boolean) {
    const { selectedFiles } = get();
    const next = new Set(selectedFiles);
    for (const key of keys) {
      if (selected) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    set({ selectedFiles: next });
  },

  selectAllFiles() {
    const { changes } = get();
    const allPaths = new Set(changes.map((f) => `${f.path}:${f.staged}`));
    set({ selectedFiles: allPaths });
  },

  deselectAllFiles() {
    set({ selectedFiles: new Set() });
  },

  highlightFile(key: string, mode: "single" | "toggle") {
    const { highlightedFiles } = get();
    if (mode === "single") {
      set({ highlightedFiles: new Set([key]) });
    } else {
      // toggle (Cmd+click)
      const next = new Set(highlightedFiles);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      set({ highlightedFiles: next });
    }
  },

  async stageFile(filePath: string) {
    try {
      await bridge.request("stageFile", {
        filePath,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
    } catch (err) {
      console.error("stageFile failed:", err);
    }
  },

  async unstageFile(filePath: string) {
    try {
      await bridge.request("unstageFile", {
        filePath,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
    } catch (err) {
      console.error("unstageFile failed:", err);
    }
  },

  async stageAll() {
    try {
      await bridge.request("stageAll", { repoPath: get().currentRepoPath });
      await get().fetchChanges();
    } catch (err) {
      console.error("stageAll failed:", err);
    }
  },

  async unstageAll() {
    try {
      await bridge.request("unstageAll", { repoPath: get().currentRepoPath });
      await get().fetchChanges();
    } catch (err) {
      console.error("unstageAll failed:", err);
    }
  },

  async stageFiles(filePaths: string[]) {
    if (filePaths.length === 0) return;
    try {
      await bridge.request("stageFiles", {
        filePaths,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
    } catch (err) {
      console.error("stageFiles failed:", err);
    }
  },

  async unstageFiles(filePaths: string[]) {
    if (filePaths.length === 0) return;
    try {
      await bridge.request("unstageFiles", {
        filePaths,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
    } catch (err) {
      console.error("unstageFiles failed:", err);
    }
  },

  async commit() {
    const { commitMessage, amend, changes, selectedFiles } = get();
    if (!commitMessage.trim()) return false;

    // Get selected file paths (only unstaged ones need to be staged)
    const filesToStage = changes
      .filter((f) => !f.staged && selectedFiles.has(`${f.path}:${f.staged}`))
      .map((f) => f.path);

    try {
      set({ loading: true });
      // 对齐 commitAndPush 的 60s 超时：本地 commit 通常毫秒级，但 pre-commit
      // hook / 大 diff / 慢磁盘可能拖到数秒~十余秒。默认 10s 超时会在 commit
      // 实际已成功（后端仍在执行）时误判失败，导致输入框残留且无错误提示。
      await bridge.request(
        "commitChanges",
        {
          message: commitMessage,
          amend,
          filePaths: filesToStage,
          repoPath: get().currentRepoPath,
        },
        { timeout: 60_000 },
      );
      set({
        commitMessage: "",
        amend: false,
        commitEpoch: get().commitEpoch + 1,
      });
      flushDraftSave(get().currentRepoPath, "");
      await get().fetchChanges();
      return true;
    } catch (err) {
      console.error("commit failed:", err);
      // 超时兜底：commitChanges handler 先 stage（毫秒级）后 commit，能撑到
      // 60s 超时，commit 几乎必然已落地。不清空会让"已提交却残留输入框"的
      // 状态出现，故与 commitAndPush 的超时分支保持一致：清空并刷新。
      const isTimeout = err instanceof Error && err.name === "BridgeTimeout";
      if (isTimeout) {
        set({
          commitMessage: "",
          amend: false,
          commitEpoch: get().commitEpoch + 1,
        });
        flushDraftSave(get().currentRepoPath, "");
        await get().fetchChanges();
      }
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async commitAndPush() {
    const { commitMessage, amend, changes, selectedFiles } = get();
    if (!commitMessage.trim()) return false;

    const filesToStage = changes
      .filter((f) => !f.staged && selectedFiles.has(`${f.path}:${f.staged}`))
      .map((f) => f.path);

    try {
      set({ loading: true });
      const result = (await bridge.request(
        "commitAndPush",
        {
          message: commitMessage,
          amend,
          filePaths: filesToStage,
          repoPath: get().currentRepoPath,
        },
        // push 是网络操作，默认 10s 超时不够；放宽到 60s。
        { timeout: 60_000 },
      )) as { pushed?: boolean; pushError?: string };
      // The commit itself succeeded (the request resolved), so clear the
      // message and draft regardless of whether the push went through.
      set({
        commitMessage: "",
        amend: false,
        commitEpoch: get().commitEpoch + 1,
      });
      flushDraftSave(get().currentRepoPath, "");
      await get().fetchChanges();
      // A rejected push must not stay silent: surface the error to the user.
      if (!result?.pushed) {
        const msg = result?.pushError || t("Push failed");
        bridge
          .request("showErrorNotification", { message: msg })
          .catch(() => {});
      }
      return true;
    } catch (err) {
      console.error("commitAndPush failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      // 超时兜底：后端 commitAndPush 先 commit（本地操作，毫秒级）后 push，
      // 一旦触发超时，commit 必然已成功（不可能在超时阈值内仍未完成本地
      // commit），故清空消息与草稿，避免提交已落地却残留输入框。
      // 用 err.name 而非 message 文本判定（翻译后 message 不含 "timed out"）。
      const isTimeout = err instanceof Error && err.name === "BridgeTimeout";
      if (isTimeout) {
        set({
          commitMessage: "",
          amend: false,
          commitEpoch: get().commitEpoch + 1,
        });
        flushDraftSave(get().currentRepoPath, "");
        await get().fetchChanges();
      }
      bridge.request("showErrorNotification", { message: msg }).catch(() => {});
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async rollbackFile(filePath: string) {
    try {
      await bridge.request("rollbackFile", {
        filePath,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
    } catch (err) {
      console.error("rollbackFile failed:", err);
    }
  },

  async showDiff(filePath: string, staged?: boolean) {
    try {
      await bridge.request("showDiffForWorkingFile", {
        filePath,
        staged,
        repoPath: get().currentRepoPath,
      });
    } catch (err) {
      console.error("showDiff failed:", err);
    }
  },

  async stashChanges(message?: string, filePaths?: string[]) {
    try {
      set({ loading: true });
      await bridge.request("stashChanges", {
        message,
        filePaths,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
      await get().fetchStashes();
    } catch (err) {
      console.error("stashChanges failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  async unstashChanges(stashId: string, drop = true) {
    try {
      set({ loading: true });
      await bridge.request("unstashChanges", {
        stashId,
        drop,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
      await get().fetchStashes();
    } catch (err) {
      console.error("unstashChanges failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  async deleteStash(stashId: string) {
    try {
      await bridge.request("deleteStash", {
        stashId,
        repoPath: get().currentRepoPath,
      });
      await get().fetchStashes();
    } catch (err) {
      console.error("deleteStash failed:", err);
    }
  },

  setActiveTab(tab: TabType) {
    set({ activeTab: tab });
    if (tab === "stash") {
      get().fetchStashes();
    }
  },

  toggleGroup(group: string) {
    const { expandedGroups } = get();
    const next = new Set(expandedGroups);
    if (next.has(group)) {
      next.delete(group);
    } else {
      next.add(group);
    }
    set({ expandedGroups: next });
  },

  toggleDir(dirPath: string) {
    const { collapsedDirs } = get();
    const next = new Set(collapsedDirs);
    if (next.has(dirPath)) {
      next.delete(dirPath);
    } else {
      next.add(dirPath);
    }
    set({ collapsedDirs: next });
  },

  expandAllDirs() {
    set({ collapsedDirs: new Set() });
  },

  collapseAllDirs(allDirPaths: string[]) {
    set({ collapsedDirs: new Set(allDirPaths) });
  },

  toggleGroupByDirectory() {
    const next = !get().groupByDirectory;
    // When toggling to directory mode, reset collapsed state so DirectoryTree will collapse all on mount
    if (next) {
      set({ groupByDirectory: true, collapsedDirs: new Set() });
    } else {
      set({ groupByDirectory: false, collapsedDirs: new Set() });
    }
  },

  toggleShowUnversioned() {
    set({ showUnversioned: !get().showUnversioned });
  },

  async fetchGitConfig() {
    try {
      const result = (await bridge.request("getGitConfig")) as {
        commitListStyle?: "vscode" | "jetbrains";
        commitBadgeMode?: "total" | "current" | "off";
        skipPushConfirmation?: boolean;
      };
      const commitListStyle = result?.commitListStyle ?? "vscode";
      const commitBadgeMode = result?.commitBadgeMode ?? "current";
      const skipPushConfirmation = result?.skipPushConfirmation ?? true;
      set({ commitListStyle, commitBadgeMode, skipPushConfirmation });
    } catch (err) {
      console.error("fetchGitConfig failed:", err);
    }
  },

  async fetchAiConfig() {
    try {
      const result = (await bridge.request("getAiConfig")) as {
        configured: boolean;
        hasApiKey: boolean;
        apiUrl: string;
        model: string;
        timeout: number;
      };
      set({
        aiConfigured: result?.configured ?? false,
        aiApiUrl: result?.apiUrl ?? "",
        aiModel: result?.model ?? "",
        aiTimeout: result?.timeout ?? 30,
      });
    } catch (err) {
      console.error("fetchAiConfig failed:", err);
    }
  },

  async generateCommitMessage() {
    const mySeq = get().repoSeq;
    const startEpoch = get().commitEpoch;
    const { commitListStyle, selectedFiles, changes } = get();
    if (changes.length === 0) return;

    set({ aiGenerating: true });
    try {
      const filePaths = [...selectedFiles].map((key) => key.split(":")[0]);
      const uniquePaths = [...new Set(filePaths)];

      const result = (await bridge.request(
        "generateCommitMessage",
        { commitListStyle, selectedFiles: uniquePaths, repoPath: get().currentRepoPath },
        { timeout: (get().aiTimeout + 10) * 1000 },
      )) as { message?: string; source?: string; status?: string };

      if (mySeq !== get().repoSeq) return;
      // A commit landed while the AI request was in flight — the textarea was
      // cleared; do not re-fill it with the just-committed message.
      if (get().commitEpoch !== startEpoch) return;

      if (result?.status === "not_git_repo") {
        bridge.request("showErrorNotification", {
          message: t("No active repository."),
        }).catch(() => {});
        return;
      }

      if (result?.message) {
        get().setCommitMessage(result.message);
      }
    } catch (err) {
      if (mySeq !== get().repoSeq) return;
      // 用户主动取消 → 静默处理，不弹错误通知
      if (get().aiCancelling) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error("generateCommitMessage failed:", msg);

      // Categorize error and offer actionable guidance
      const isAuthError = /\b40[13]\b|unauthorized|invalid.*key/i.test(msg);
      const isConfigError = /\b404\b|model|not.?found|econnrefused|enotfound|fetch failed|timed out/i.test(msg);

      const openSettingsLabel = t("Open Settings");
      const setKeyLabel = t("Set API Key");
      const actions = isAuthError ? [setKeyLabel] : isConfigError ? [openSettingsLabel] : [];

      bridge.request(
        "showErrorNotification",
        { message: msg, actions },
        { timeout: 120_000 },
      ).then((res) => {
        const action = (res as { action?: string })?.action;
        if (action === openSettingsLabel) {
          bridge.request("openAiSettings").catch(() => {});
        } else if (action === setKeyLabel) {
          bridge.request("setAiApiKey", {}, { timeout: 120_000 }).catch(() => {});
        }
      }).catch(() => {});
    } finally {
      // Always clear aiGenerating — unlike fetchChanges, there's no automatic
      // re-trigger on repo switch, so a conditional clear would leave it stuck.
      set({ aiGenerating: false, aiCancelling: false });
    }
  },

  async cancelCommitMessage() {
    // 标记取消，generateCommitMessage 的 catch 据此跳过错误提示
    if (!get().aiGenerating) return;
    set({ aiCancelling: true });
    try {
      await bridge.request("cancelCommitMessageGeneration");
    } catch {
      // ignore — 即使取消请求失败，生成请求最终也会返回并清掉 aiGenerating
    }
  },

  async setCommitListStyle(style) {
    // Optimistic local update + persist to settings; backend broadcasts
    // gitConfigChanged which makes all webviews refetch.
    set({ commitListStyle: style });
    try {
      await bridge.request("setGitConfig", { commitListStyle: style });
    } catch (err) {
      console.error("setCommitListStyle failed:", err);
    }
  },

  async setCommitBadgeMode(mode) {
    // Optimistic local update + persist to settings; backend broadcasts
    // gitConfigChanged which makes all webviews refetch.
    set({ commitBadgeMode: mode });
    try {
      await bridge.request("setGitConfig", { commitBadgeMode: mode });
    } catch (err) {
      console.error("setCommitBadgeMode failed:", err);
    }
  },

  async rollbackFiles(filePaths: string[]) {
    try {
      await bridge.request("rollbackFiles", {
        filePaths,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
    } catch (err) {
      console.error("rollbackFiles failed:", err);
    }
  },

  async refresh() {
    await Promise.all([
      get().fetchChanges(),
      get().fetchStashes(),
    ]);
  },
}));

// Listen for commit state changes + multi-repo events.
//
// repoChanged (oracle hard constraint #3): the host is the single source of
// truth for the active repo. On switch it broadcasts repoChanged; we bump seq
// (dropping every in-flight fetch for the old repo), clear ALL per-repo derived
// state (changes/selection/stashes/commit message — none of it is valid for the
// valid for the new repo), then refetch.
//
// gitStateChanged / commitStateChanged: the watcher tags gitStateChanged with
// the owning repoPath. We only refresh when the event is for the current repo
// (or carries no repoPath, e.g. the global { scope: "all" } broadcasts from
// command handlers).
bridge.onEvent((event, data) => {
  if (event === "gitConfigChanged") {
    useCommitStore.getState().fetchGitConfig();
    useCommitStore.getState().fetchAiConfig();
    return;
  }
  if (event === "aiConfigChanged") {
    useCommitStore.getState().fetchAiConfig();
    return;
  }
  if (event === "repoChanged") {
    const { repoPath } = (data ?? {}) as { repoPath?: string | null };
    const state = useCommitStore.getState();
    // 切换前立即落盘旧 repo 的草稿（含尚未到期的防抖写入），避免丢字。
    flushDraftSave(state.currentRepoPath, state.commitMessage);
    useCommitStore.setState({
      repoSeq: state.repoSeq + 1,
      commitEpoch: state.commitEpoch + 1,
      currentRepoPath: repoPath ?? state.currentRepoPath,
      changes: [],
      selectedFiles: new Set(),
      highlightedFiles: new Set(),
      stashes: [],
      commitMessage: "",
      amend: false,
    });
    useCommitStore.getState().fetchChanges();
    // Refresh badges for the new active repo (and the rest, in one round-trip).
    useCommitStore.getState().fetchRepoStatuses();
    // 回填新 repo 的草稿（loadCommitDraft 内部有 seq 竞态保护）。
    useCommitStore.getState().loadCommitDraft();
    return;
  }
  if (event === "commitStateChanged" || event === "gitStateChanged") {
    // Badges show EVERY repo's status, so refresh them on any repo's change
    // (the watcher already debounces 300ms, so a full round-trip is acceptable).
    useCommitStore.getState().fetchRepoStatuses();
    const { repoPath } = (data ?? {}) as { repoPath?: string };
    // Multi-repo filter: only refresh changes/stashes for the current repo.
    // Events without repoPath (global command-handler broadcasts) are always
    // honored.
    if (repoPath && repoPath !== useCommitStore.getState().currentRepoPath) {
      return;
    }
    useCommitStore.getState().fetchChanges();
    useCommitStore.getState().fetchStashes();
    return;
  }
});
