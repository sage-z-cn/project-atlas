import { create } from "zustand";
import { bridge } from "../bridge";
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

export interface ShelveEntry {
  id: string;
  message: string;
  date: string;
  branch: string;
  files: string[];
}

export interface IdeaShelfEntry {
  name: string;
  description: string;
  date: string;
  patchPath: string;
  files: string[];
}

type TabType = "commit" | "shelf" | "stash";

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

  // Shelf
  shelves: ShelveEntry[];

  // IDEA Shelf
  ideaShelves: IdeaShelfEntry[];

  // UI state
  activeTab: TabType;
  loading: boolean;
  expandedGroups: Set<string>;
  groupByDirectory: boolean;
  showUnversioned: boolean;
  /** Collapsed directory paths in tree view */
  collapsedDirs: Set<string>;

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
  fetchShelves: () => Promise<void>;
  setCommitMessage: (msg: string) => void;
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
  commit: () => Promise<boolean>;
  commitAndPush: () => Promise<boolean>;
  rollbackFile: (filePath: string) => Promise<void>;
  showDiff: (filePath: string, staged?: boolean) => Promise<void>;
  shelveChanges: (message?: string, filePaths?: string[]) => Promise<void>;
  unshelveChanges: (stashId: string, drop?: boolean) => Promise<void>;
  deleteShelve: (stashId: string) => Promise<void>;
  fetchIdeaShelves: () => Promise<void>;
  ideaShelveChanges: (message?: string, filePaths?: string[]) => Promise<void>;
  ideaUnshelveChanges: (shelfName: string, drop?: boolean) => Promise<void>;
  deleteIdeaShelf: (shelfName: string) => Promise<void>;
  setActiveTab: (tab: TabType) => void;
  toggleGroup: (group: string) => void;
  toggleDir: (dirPath: string) => void;
  expandAllDirs: () => void;
  collapseAllDirs: (allDirPaths: string[]) => void;
  toggleGroupByDirectory: () => void;
  toggleShowUnversioned: () => void;
  refresh: () => Promise<void>;
}

export const useCommitStore = create<CommitStore>((set, get) => ({
  // ── Multi-repo ─────────────────────────────────────────────────────
  currentRepoPath: null,
  repos: [],
  repoSeq: 0,
  repoStatuses: {},

  changes: [],
  selectedFiles: new Set<string>(),
  highlightedFiles: new Set<string>(),
  commitMessage: "",
  amend: false,
  shelves: [],
  ideaShelves: [],
  activeTab: "commit",
  loading: false,
  expandedGroups: new Set(["changes", "unversioned", "staged"]),
  groupByDirectory: true,
  showUnversioned: true,
  collapsedDirs: new Set<string>(),

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
    // Run the changes/shelves fetch and the badge fetch concurrently so badge
    // counts don't wait on the (300ms min-display) changes round-trip.
    await Promise.all([
      get().refresh(),
      get().fetchRepoStatuses(),
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

  async fetchShelves() {
    // ★ Capture seq + repoPath at issue time for the in-flight race guard.
    const mySeq = get().repoSeq;
    const repoPath = get().currentRepoPath;
    try {
      const result = (await bridge.request("getShelves", {
        repoPath,
      })) as ShelveEntry[];
      // ★ Race guard: a switch happened during the fetch → drop stale shelves.
      if (mySeq !== get().repoSeq) return;
      if (Array.isArray(result)) {
        set({ shelves: result });
      }
    } catch (err) {
      console.error("fetchShelves failed:", err);
    }
  },

  setCommitMessage(msg: string) {
    set({ commitMessage: msg });
  },

  setAmend(amend: boolean) {
    set({ amend });
    if (amend) {
      // Load last commit message
      void (async () => {
        try {
          const result = (await bridge.request("getAmendMessage", {
            repoPath: get().currentRepoPath,
          })) as { message: string };
          if (result?.message) {
            set({ commitMessage: result.message });
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

  async commit() {
    const { commitMessage, amend, changes, selectedFiles } = get();
    if (!commitMessage.trim()) return false;

    // Get selected file paths (only unstaged ones need to be staged)
    const filesToStage = changes
      .filter((f) => !f.staged && selectedFiles.has(`${f.path}:${f.staged}`))
      .map((f) => f.path);

    try {
      set({ loading: true });
      await bridge.request("commitChanges", {
        message: commitMessage,
        amend,
        filePaths: filesToStage,
        repoPath: get().currentRepoPath,
      });
      set({ commitMessage: "", amend: false });
      await get().fetchChanges();
      return true;
    } catch (err) {
      console.error("commit failed:", err);
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
      await bridge.request("commitAndPush", {
        message: commitMessage,
        amend,
        filePaths: filesToStage,
        repoPath: get().currentRepoPath,
      });
      set({ commitMessage: "", amend: false });
      await get().fetchChanges();
      return true;
    } catch (err) {
      console.error("commitAndPush failed:", err);
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

  async shelveChanges(message?: string, filePaths?: string[]) {
    try {
      set({ loading: true });
      await bridge.request("shelveChanges", {
        message,
        filePaths,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
      await get().fetchShelves();
    } catch (err) {
      console.error("shelveChanges failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  async unshelveChanges(stashId: string, drop = true) {
    try {
      set({ loading: true });
      await bridge.request("unshelveChanges", {
        stashId,
        drop,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
      await get().fetchShelves();
    } catch (err) {
      console.error("unshelveChanges failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  async deleteShelve(stashId: string) {
    try {
      await bridge.request("deleteShelve", {
        stashId,
        repoPath: get().currentRepoPath,
      });
      await get().fetchShelves();
    } catch (err) {
      console.error("deleteShelve failed:", err);
    }
  },

  async fetchIdeaShelves() {
    // ★ Capture seq + repoPath at issue time for the in-flight race guard.
    const mySeq = get().repoSeq;
    const repoPath = get().currentRepoPath;
    try {
      const result = (await bridge.request("getIdeaShelves", {
        repoPath,
      })) as IdeaShelfEntry[];
      // ★ Race guard: a switch happened during the fetch → drop stale shelves.
      if (mySeq !== get().repoSeq) return;
      if (Array.isArray(result)) {
        set({ ideaShelves: result });
      }
    } catch (err) {
      console.error("fetchIdeaShelves failed:", err);
    }
  },

  async ideaShelveChanges(message?: string, filePaths?: string[]) {
    try {
      set({ loading: true });
      await bridge.request("ideaShelveChanges", {
        message,
        filePaths,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
      await get().fetchIdeaShelves();
    } catch (err) {
      console.error("ideaShelveChanges failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  async ideaUnshelveChanges(shelfName: string, drop = true) {
    try {
      set({ loading: true });
      await bridge.request("ideaUnshelveChanges", {
        shelfName,
        drop,
        repoPath: get().currentRepoPath,
      });
      await get().fetchChanges();
      await get().fetchIdeaShelves();
    } catch (err) {
      console.error("ideaUnshelveChanges failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  async deleteIdeaShelf(shelfName: string) {
    try {
      await bridge.request("deleteIdeaShelf", {
        shelfName,
        repoPath: get().currentRepoPath,
      });
      await get().fetchIdeaShelves();
    } catch (err) {
      console.error("deleteIdeaShelf failed:", err);
    }
  },

  setActiveTab(tab: TabType) {
    set({ activeTab: tab });
    if (tab === "stash") {
      get().fetchShelves();
    } else if (tab === "shelf") {
      get().fetchIdeaShelves();
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

  async refresh() {
    await Promise.all([
      get().fetchChanges(),
      get().fetchShelves(),
      get().fetchIdeaShelves(),
    ]);
  },
}));

// Listen for commit state changes + multi-repo events.
//
// repoChanged (oracle hard constraint #3): the host is the single source of
// truth for the active repo. On switch it broadcasts repoChanged; we bump seq
// (dropping every in-flight fetch for the old repo), clear ALL per-repo derived
// state (changes/selection/shelves/ideaShelves/commit message — none of it is
// valid for the new repo), then refetch.
//
// gitStateChanged / commitStateChanged: the watcher tags gitStateChanged with
// the owning repoPath. We only refresh when the event is for the current repo
// (or carries no repoPath, e.g. the global { scope: "all" } broadcasts from
// command handlers).
bridge.onEvent((event, data) => {
  if (event === "repoChanged") {
    const { repoPath } = (data ?? {}) as { repoPath?: string | null };
    const state = useCommitStore.getState();
    useCommitStore.setState({
      repoSeq: state.repoSeq + 1,
      currentRepoPath: repoPath ?? state.currentRepoPath,
      changes: [],
      selectedFiles: new Set(),
      highlightedFiles: new Set(),
      shelves: [],
      ideaShelves: [],
      commitMessage: "",
      amend: false,
    });
    useCommitStore.getState().fetchChanges();
    // Refresh badges for the new active repo (and the rest, in one round-trip).
    useCommitStore.getState().fetchRepoStatuses();
    return;
  }
  if (event === "commitStateChanged" || event === "gitStateChanged") {
    // Badges show EVERY repo's status, so refresh them on any repo's change
    // (the watcher already debounces 300ms, so a full round-trip is acceptable).
    useCommitStore.getState().fetchRepoStatuses();
    const { repoPath } = (data ?? {}) as { repoPath?: string };
    // Multi-repo filter: only refresh changes/shelves for the current repo.
    // Events without repoPath (global command-handler broadcasts) are always
    // honored.
    if (repoPath && repoPath !== useCommitStore.getState().currentRepoPath) {
      return;
    }
    useCommitStore.getState().fetchChanges();
    useCommitStore.getState().fetchIdeaShelves();
    useCommitStore.getState().fetchShelves();
    return;
  }
});
