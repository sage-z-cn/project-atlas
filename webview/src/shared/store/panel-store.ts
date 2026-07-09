import { create } from "zustand";
import { bridge } from "../bridge";
import type { SelectionMode } from "../hooks/useModifierClickSelection";
import type {
  BranchInfo,
  Commit,
  DiffFile,
  LaneInfo,
  LaneSnapshot,
  RepoInfo,
  RepoStatus,
  TagInfo,
} from "../types/git";

interface PanelFilter {
  searchQuery: string;
  branch: string;
  author: string;
  dateRange: string;
  file: string;
}

interface PanelStore {
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
   * getGraphData for repo A can resolve AFTER the user switched to repo B
   * and would otherwise overwrite repo B's data with repo A's.
   */
  repoSeq: number;
  /**
   * Per-repo ahead/behind/dirty counts keyed by normalized repo path, backing
   * the RepoSelector chip badges. Refreshed by fetchRepoStatuses on init,
   * repoChanged, and every gitStateChanged (badges must reflect other repos'
   * state too, so the refresh is NOT gated to the current repo).
   */
  repoStatuses: Record<string, RepoStatus>;

  commits: Commit[];
  /** Commits filtered by search/author (client-side). Graph layout uses full `commits`. */
  visibleCommits: Commit[];
  branches: BranchInfo[];
  tags: TagInfo[];
  currentBranch: string;
  graphLayout: Record<string, LaneInfo>;
  laneSnapshot: LaneSnapshot | null;

  selectedCommitHash: string | null;
  selectedCommitHashes: string[];
  lastSelectedCommitHash: string | null;
  hoveredColumn: number | null;
  commitFiles: DiffFile[];
  selectedFilePath: string | null;
  /**
   * One-shot scroll trigger for CommitList. When set, CommitList's useEffect
   * scrolls the row into view then clears it back to null. Backs the
   * "Navigate Log to Branch Head" single-click action — the host broadcasts a
   * gitStateChanged with scope:"navigateToHead" and the listener here resolves
   * the branch's head hash into this field.
   */
  scrollTargetHash: string | null;
  /** Column visibility for the commit list */
  visibleColumns: { author: boolean; date: boolean; hash: boolean };
  /** When multiple commits are selected, stores the oldest/newest for range diff */
  rangeOldest: string | null;
  rangeNewest: string | null;
  selectedBranches: string[];
  lastSelectedBranch: string | null;
  branchGroupByDirectory: boolean;
  /** Whether the Tags group is shown in the branch tree (Settings menu toggle). */
  showTags: boolean;
  /** What a plain single-click on a branch row does (Settings menu). */
  singleClickAction: "updateBranchFilter" | "navigateToHead";

  filter: PanelFilter;
  /** Hashes to restore after clearing a filter */
  pendingSelectionFromFilter: string[];
  /** Collapsed sequence IDs */
  collapsedSequenceIds: Set<string>;
  /** sequenceId → intermediate hashes that are hidden */
  collapsedIntermediates: Map<string, string[]>;

  loading: boolean;
  hasMore: boolean;
  operationInProgress: boolean;

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

  fetchInitialData: () => Promise<void>;
  loadMore: () => Promise<void>;
  selectCommit: (
    hash: string,
    mode?: SelectionMode,
    allVisibleCommits?: string[],
  ) => Promise<void>;
  selectFile: (filePath: string) => void;
  openDiffEditor: (commitHash: string, file: DiffFile) => Promise<void>;
  setFilter: (filter: Partial<PanelFilter>) => void;
  selectBranch: (
    name: string,
    mode: "single" | "toggle" | "range",
    allVisibleBranches: string[],
  ) => void;
  setHoveredColumn: (column: number | null) => void;
  toggleColumnVisibility: (column: "author" | "date" | "hash") => void;
  toggleSequenceCollapse: (sequenceId: string, intermediates: string[]) => void;
  toggleBranchGroupByDirectory: () => void;
  toggleShowTags: () => void;
  setSingleClickAction: (action: "updateBranchFilter" | "navigateToHead") => void;
  refresh: () => Promise<void>;
}

interface SelectionSnapshot {
  selectedCommitHash: string | null;
  selectedCommitHashes: string[];
  lastSelectedCommitHash: string | null;
  rangeOldest: string | null;
  rangeNewest: string | null;
}

function filterCommits(
  commits: Commit[],
  filter: PanelFilter,
  collapsedIntermediates: Map<string, string[]>,
): Commit[] {
  const hiddenSet = new Set<string>();
  for (const hashes of collapsedIntermediates.values()) {
    for (const h of hashes) hiddenSet.add(h);
  }

  // Compute date cutoff for dateRange filter
  let dateCutoff: Date | null = null;
  if (filter.dateRange) {
    const now = new Date();
    if (filter.dateRange === "today") {
      dateCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (filter.dateRange === "7days") {
      dateCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (filter.dateRange === "30days") {
      dateCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (filter.dateRange === "90days") {
      dateCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }
  }

  return commits.filter((c) => {
    if (hiddenSet.has(c.hash)) return false;

    if (filter.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      if (
        !c.subject.toLowerCase().includes(q) &&
        !c.body.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    if (filter.author) {
      if (!c.authorName.toLowerCase().includes(filter.author.toLowerCase())) {
        return false;
      }
    }
    if (dateCutoff) {
      const commitDate = new Date(c.authorDate);
      if (commitDate < dateCutoff) {
        return false;
      }
    }
    return true;
  });
}

function deriveSelectionFromVisible(
  visibleCommits: Commit[],
  selectedCommitHashes: string[],
  selectedCommitHash: string | null,
  lastSelectedCommitHash: string | null,
): SelectionSnapshot {
  const visibleHashes = visibleCommits.map((c) => c.hash);
  const visibleSet = new Set(visibleHashes);
  const nextSelected = selectedCommitHashes.filter((h) => visibleSet.has(h));

  if (nextSelected.length === 0) {
    const fallback = visibleCommits[0]?.hash ?? null;
    if (!fallback) {
      return {
        selectedCommitHash: null,
        selectedCommitHashes: [],
        lastSelectedCommitHash: null,
        rangeOldest: null,
        rangeNewest: null,
      };
    }
    return {
      selectedCommitHash: fallback,
      selectedCommitHashes: [fallback],
      lastSelectedCommitHash: fallback,
      rangeOldest: fallback,
      rangeNewest: fallback,
    };
  }

  const ordered = visibleHashes.filter((h) => nextSelected.includes(h));
  const preferredFocus =
    selectedCommitHash && visibleSet.has(selectedCommitHash);
  const nextFocus = preferredFocus ? selectedCommitHash : ordered[0];
  const nextAnchor =
    lastSelectedCommitHash && visibleSet.has(lastSelectedCommitHash)
      ? lastSelectedCommitHash
      : ordered[0];

  return {
    selectedCommitHash: nextFocus,
    selectedCommitHashes: ordered,
    lastSelectedCommitHash: nextAnchor,
    rangeOldest: ordered[ordered.length - 1],
    rangeNewest: ordered[0],
  };
}

export const usePanelStore = create<PanelStore>((set, get) => ({
  // ── Multi-repo ─────────────────────────────────────────────────────
  currentRepoPath: null,
  repos: [],
  repoSeq: 0,
  repoStatuses: {},

  commits: [],
  visibleCommits: [],
  branches: [],
  tags: [],
  currentBranch: "",
  graphLayout: {},
  laneSnapshot: null,

  selectedCommitHash: null,
  selectedCommitHashes: [],
  lastSelectedCommitHash: null,
  hoveredColumn: null,
  commitFiles: [],
  selectedFilePath: null,
  scrollTargetHash: null,
  visibleColumns: { author: true, date: true, hash: true },
  rangeOldest: null,
  rangeNewest: null,
  selectedBranches: [],
  lastSelectedBranch: null,
  branchGroupByDirectory: (() => {
    try {
      return localStorage.getItem("branchGroupByDirectory") === "true";
    } catch {
      return false;
    }
  })(),
  showTags: (() => {
    try {
      const v = localStorage.getItem("showTags");
      // Default: show tags (null/unset → true).
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  })(),
  singleClickAction: (() => {
    try {
      const v = localStorage.getItem("singleClickAction");
      return v === "navigateToHead" ? "navigateToHead" : "updateBranchFilter";
    } catch {
      return "updateBranchFilter";
    }
  })(),

  filter: { searchQuery: "", branch: "", author: "", dateRange: "", file: "" },
  pendingSelectionFromFilter: [],
  collapsedSequenceIds: new Set(),
  collapsedIntermediates: new Map(),

  loading: false,
  hasMore: true,
  operationInProgress: false,

  // ── Multi-repo actions ─────────────────────────────────────────────
  async switchRepo(path: string) {
    // Bump seq FIRST so every in-flight fetch for the old repo drops its
    // (possibly still-incoming) response. We intentionally do NOT optimistically
    // set currentRepoPath here — the host is the source of truth and will
    // broadcast repoChanged, which the event listener handles.
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
        // Bump seq so any stray fetch issued before this handshake resolves
        // (none in practice, but defensive) is dropped.
        repoSeq: get().repoSeq + 1,
      });
    } catch (err) {
      console.error("initRepo failed:", err);
    }
    // Run the graph fetch and the badge fetch concurrently so the (fast) badge
    // counts don't wait on the (slow, 1s+ min-display) getGraphData round-trip.
    await Promise.all([
      get().fetchInitialData(),
      get().fetchRepoStatuses(),
    ]);
  },

  async fetchRepoStatuses() {
    // ★ Capture seq at issue time. Badges reflect every repo (not just the
    // current one), so the response stays valid across a switch — but we still
    // guard so a stale response can't clobber a fresher one (e.g. an in-flight
    // full-status fetch landing after a newer one already settled).
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

  async fetchInitialData() {
    // ★ Capture seq + repoPath at issue time. A switch that happens during the
    // await below bumps repoSeq, so `mySeq` becomes stale and we drop the
    // response instead of overwriting the new repo's data.
    const mySeq = get().repoSeq;
    const repoPath = get().currentRepoPath;
    set({ loading: true });
    const start = Date.now();
    try {
      const { filter } = get();
      const [graphResult, branches, tags] = await Promise.all([
        bridge.request("getGraphData", {
          maxCount: 200,
          branch: filter.branch || undefined,
          file: filter.file || undefined,
          repoPath,
        }) as Promise<{
          graphData: { commits: Commit[]; lanes: Record<string, LaneInfo> };
          snapshot: LaneSnapshot;
        } | null>,
        bridge.request("getBranches", { repoPath }) as Promise<
          BranchInfo[] | null
        >,
        bridge.request("getTags", { repoPath }) as Promise<TagInfo[] | null>,
      ]);

      // ★ Race guard: a switch happened during the fetch → drop stale response.
      if (mySeq !== get().repoSeq) return;

      const commits = graphResult?.graphData?.commits ?? [];
      const lanes = graphResult?.graphData?.lanes ?? {};
      const snapshot = graphResult?.snapshot ?? null;
      const branchList = branches ?? [];
      const tagList = tags ?? [];
      const current = branchList.find((b) => b.isCurrent)?.name ?? "";

      const { pendingSelectionFromFilter, collapsedIntermediates } = get();

      const visible = filterCommits(commits, filter, collapsedIntermediates);

      // Check if we need to restore selection from a cleared filter
      if (pendingSelectionFromFilter.length > 0) {
        const validHashes = pendingSelectionFromFilter.filter((h) =>
          commits.some((c) => c.hash === h),
        );
        if (validHashes.length > 0) {
          set({
            commits,
            visibleCommits: visible,
            graphLayout: lanes,
            laneSnapshot: snapshot,
            branches: branchList,
            tags: tagList,
            currentBranch: current,

            hasMore: commits.length >= 200,
            selectedCommitHash: validHashes[0],
            selectedCommitHashes: validHashes,
            lastSelectedCommitHash: validHashes[0],
            commitFiles: [],
            selectedFilePath: null,
            rangeOldest: validHashes[validHashes.length - 1],
            rangeNewest: validHashes[0],
            pendingSelectionFromFilter: [],
          });

          const files = (await bridge.request("getCommitRangeFiles", {
            hashes: validHashes,
            repoPath,
          })) as DiffFile[] | null;
          // ★ Race guard before applying the late-arriving file list.
          if (mySeq !== get().repoSeq) return;
          set({ commitFiles: files ?? [] });
          return;
        }
      }

      const firstVisible = visible[0];
      set({
        commits,
        visibleCommits: visible,
        graphLayout: lanes,
        laneSnapshot: snapshot,
        branches: branchList,
        tags: tagList,
        currentBranch: current,

        hasMore: commits.length >= 200,
        selectedCommitHash: firstVisible?.hash ?? null,
        selectedCommitHashes: firstVisible ? [firstVisible.hash] : [],
        lastSelectedCommitHash: firstVisible?.hash ?? null,
        commitFiles: [],
        selectedFilePath: null,
        rangeOldest: null,
        rangeNewest: null,
        pendingSelectionFromFilter: [],
      });

      // Auto-select first visible commit
      if (firstVisible) {
        const hash = firstVisible.hash;
        const files = (await bridge.request("getCommitRangeFiles", {
          hashes: [hash],
          repoPath,
        })) as DiffFile[] | null;
        // ★ Race guard: drop late file list if a switch/repoChanged occurred.
        if (mySeq !== get().repoSeq) return;
        set({ commitFiles: files ?? [], rangeOldest: hash, rangeNewest: hash });
      }
    } catch (err) {
      console.error("fetchInitialData failed:", err);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed));
      }
      // ★ Only clear loading if we're still the active seq — otherwise the
      // newer fetch owns the loading indicator.
      if (mySeq === get().repoSeq) set({ loading: false });
    }
  },

  async loadMore() {
    const { commits, laneSnapshot, hasMore, loading, filter } = get();
    if (!hasMore || loading) return;

    // ★ Capture seq + repoPath for the in-flight guard.
    const mySeq = get().repoSeq;
    const repoPath = get().currentRepoPath;

    set({ loading: true });
    try {
      const result = (await bridge.request("loadMoreLog", {
        skip: commits.length,
        count: 200,
        snapshot: laneSnapshot,
        branch: filter.branch || undefined,
        file: filter.file || undefined,
        repoPath,
      })) as {
        graphData: { commits: Commit[]; lanes: Record<string, LaneInfo> };
        snapshot: LaneSnapshot;
      } | null;

      // ★ Race guard: a switch happened during the load → drop stale page.
      if (mySeq !== get().repoSeq) return;

      if (result?.graphData?.commits?.length) {
        const newCommits = result.graphData.commits;
        const allCommits = [...commits, ...newCommits];
        set({
          commits: allCommits,
          visibleCommits: filterCommits(
            allCommits,
            get().filter,
            get().collapsedIntermediates,
          ),
          graphLayout: { ...get().graphLayout, ...result.graphData.lanes },
          laneSnapshot: result.snapshot,
          hasMore: newCommits.length >= 200,
          loading: false,
        });
      } else {
        set({ hasMore: false, loading: false });
      }
    } catch (err) {
      console.error("loadMore failed:", err);
      if (mySeq === get().repoSeq) set({ loading: false });
    }
  },

  async selectCommit(
    hash: string,
    mode: SelectionMode = "single",
    allVisibleCommits: string[] = [],
  ) {
    const { selectedCommitHashes, lastSelectedCommitHash } = get();
    let nextSelected: string[] = [];
    let nextAnchor = lastSelectedCommitHash;

    if (mode === "single") {
      nextSelected = [hash];
      nextAnchor = hash;
    } else if (mode === "toggle") {
      if (selectedCommitHashes.includes(hash)) {
        nextSelected = selectedCommitHashes.filter((h) => h !== hash);
        if (nextSelected.length === 0) {
          nextSelected = [hash];
        }
      } else {
        nextSelected = [...selectedCommitHashes, hash];
      }
      nextAnchor = hash;
    } else {
      const anchor = lastSelectedCommitHash;
      if (!anchor || allVisibleCommits.length === 0) {
        nextSelected = [hash];
        nextAnchor = hash;
      } else {
        const anchorIdx = allVisibleCommits.indexOf(anchor);
        const targetIdx = allVisibleCommits.indexOf(hash);
        if (anchorIdx === -1 || targetIdx === -1) {
          nextSelected = [hash];
          nextAnchor = hash;
        } else {
          const start = Math.min(anchorIdx, targetIdx);
          const end = Math.max(anchorIdx, targetIdx);
          nextSelected = allVisibleCommits.slice(start, end + 1);
        }
      }
    }

    const focusHash = nextSelected.includes(hash)
      ? hash
      : (nextSelected[nextSelected.length - 1] ?? hash);

    // Sort selected hashes by visible list order (newest first)
    const selected = new Set(nextSelected);
    const orderedHashes =
      allVisibleCommits.length > 0
        ? allVisibleCommits.filter((h) => selected.has(h))
        : nextSelected;

    set({
      selectedCommitHash: focusHash,
      selectedCommitHashes: nextSelected,
      lastSelectedCommitHash: nextAnchor,
      commitFiles: [],
      selectedFilePath: null,
      rangeOldest: orderedHashes[orderedHashes.length - 1],
      rangeNewest: orderedHashes[0],
    });
    // ★ Capture seq + repoPath so a late file-list resolution after a switch
    // is dropped (UI was already cleared by the repoChanged handler).
    const mySeq = get().repoSeq;
    const repoPath = get().currentRepoPath;
    try {
      const files = (await bridge.request("getCommitRangeFiles", {
        hashes: orderedHashes,
        repoPath,
      })) as DiffFile[] | null;
      if (mySeq !== get().repoSeq) return;
      set({ commitFiles: files ?? [] });
    } catch (err) {
      console.error("selectCommit failed:", err);
    }
  },

  selectFile(filePath: string) {
    set({ selectedFilePath: filePath });
  },

  async openDiffEditor(commitHash: string, file: DiffFile) {
    try {
      const { selectedCommitHashes, commitFiles } = get();
      const repoPath = get().currentRepoPath;
      const filePath = file.newPath || file.oldPath;
      const isMulti = selectedCommitHashes.length > 1;

      if (isMulti) {
        await bridge.request("openDiffEditor", {
          commit: selectedCommitHashes[0],
          filePath,
          file,
          cherryPickHashes: selectedCommitHashes,
          fileList: commitFiles,
          repoPath,
        });
      } else {
        await bridge.request("openDiffEditor", {
          commit: commitHash,
          filePath,
          file,
          fileList: commitFiles,
          repoPath,
        });
      }
    } catch (err) {
      console.error("openDiffEditor failed:", err);
    }
  },

  setFilter(partial: Partial<PanelFilter>) {
    const { filter: current, selectedCommitHashes, commits } = get();
    const next = { ...current, ...partial };

    // Branch or file filter changes require a backend re-fetch
    if (
      (partial.branch !== undefined && partial.branch !== current.branch) ||
      (partial.file !== undefined && partial.file !== current.file)
    ) {
      set({
        filter: next,
        pendingSelectionFromFilter: [],
        collapsedSequenceIds: new Set(),
        collapsedIntermediates: new Map(),
      });
      get().fetchInitialData();
      return;
    }

    // Search/author filter: client-side only
    const wasFiltered = !!(
      current.searchQuery ||
      current.author ||
      current.dateRange
    );
    const isNowFiltered = !!(next.searchQuery || next.author || next.dateRange);
    const visible = filterCommits(commits, next, get().collapsedIntermediates);

    if (wasFiltered && !isNowFiltered) {
      // Clearing filter → save current selection for restoration
      set({
        filter: next,
        visibleCommits: visible,
        pendingSelectionFromFilter: selectedCommitHashes,
      });
    } else {
      set({
        filter: next,
        visibleCommits: visible,
        pendingSelectionFromFilter: [],
      });
    }
  },

  selectBranch(
    name: string,
    mode: "single" | "toggle" | "range",
    allVisibleBranches: string[],
  ) {
    if (mode === "single") {
      set({ selectedBranches: [name], lastSelectedBranch: name });
    } else if (mode === "toggle") {
      const current = get().selectedBranches;
      if (current.includes(name)) {
        set({
          selectedBranches: current.filter((b) => b !== name),
          lastSelectedBranch: name,
        });
      } else {
        set({ selectedBranches: [...current, name], lastSelectedBranch: name });
      }
    } else {
      // range
      const anchor = get().lastSelectedBranch;
      if (!anchor) {
        set({ selectedBranches: [name], lastSelectedBranch: name });
        return;
      }
      const anchorIdx = allVisibleBranches.indexOf(anchor);
      const targetIdx = allVisibleBranches.indexOf(name);
      if (anchorIdx === -1 || targetIdx === -1) {
        set({ selectedBranches: [name], lastSelectedBranch: name });
        return;
      }
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      set({ selectedBranches: allVisibleBranches.slice(start, end + 1) });
    }
  },

  setHoveredColumn(column: number | null) {
    set({ hoveredColumn: column });
  },

  toggleColumnVisibility(column: "author" | "date" | "hash") {
    set((state) => ({
      visibleColumns: {
        ...state.visibleColumns,
        [column]: !state.visibleColumns[column],
      },
    }));
  },

  toggleBranchGroupByDirectory() {
    set((state) => {
      const next = !state.branchGroupByDirectory;
      try {
        localStorage.setItem("branchGroupByDirectory", String(next));
      } catch {
        // ignore
      }
      return { branchGroupByDirectory: next };
    });
  },

  toggleShowTags() {
    const next = !get().showTags;
    try {
      localStorage.setItem("showTags", String(next));
    } catch {
      // ignore
    }
    set({ showTags: next });
  },

  setSingleClickAction(action) {
    try {
      localStorage.setItem("singleClickAction", action);
    } catch {
      // ignore
    }
    set({ singleClickAction: action });
  },

  toggleSequenceCollapse(sequenceId: string, intermediates: string[]) {
    const {
      commits,
      filter,
      collapsedSequenceIds,
      collapsedIntermediates,
      selectedCommitHashes,
      selectedCommitHash,
      lastSelectedCommitHash,
    } = get();
    const nextIds = new Set(collapsedSequenceIds);
    const nextMap = new Map(collapsedIntermediates);

    if (nextIds.has(sequenceId)) {
      nextIds.delete(sequenceId);
      nextMap.delete(sequenceId);
    } else {
      nextIds.add(sequenceId);
      nextMap.set(sequenceId, intermediates);
    }

    const nextVisible = filterCommits(commits, filter, nextMap);
    const nextSelection = deriveSelectionFromVisible(
      nextVisible,
      selectedCommitHashes,
      selectedCommitHash,
      lastSelectedCommitHash,
    );

    set({
      collapsedSequenceIds: nextIds,
      collapsedIntermediates: nextMap,
      visibleCommits: nextVisible,
      selectedCommitHash: nextSelection.selectedCommitHash,
      selectedCommitHashes: nextSelection.selectedCommitHashes,
      lastSelectedCommitHash: nextSelection.lastSelectedCommitHash,
      rangeOldest: nextSelection.rangeOldest,
      rangeNewest: nextSelection.rangeNewest,
      selectedFilePath: null,
      commitFiles: [],
    });

    const hashes = nextSelection.selectedCommitHashes;
    if (hashes.length > 0) {
      // ★ Capture seq + repoPath so a late file fetch after a switch is dropped.
      const mySeq = get().repoSeq;
      const repoPath = get().currentRepoPath;
      void (async () => {
        try {
          const files = (await bridge.request("getCommitRangeFiles", {
            hashes,
            repoPath,
          })) as DiffFile[] | null;
          if (mySeq !== get().repoSeq) return;
          set({ commitFiles: files ?? [] });
        } catch (err) {
          console.error("toggleSequenceCollapse failed to load files:", err);
        }
      })();
    }
  },

  async refresh() {
    set({ collapsedSequenceIds: new Set(), collapsedIntermediates: new Map() });
    await get().fetchInitialData();
  },
}));

// Listen for git state changes + multi-repo events.
//
// repoChanged (oracle hard constraint #3): the host is the single source of
// truth for the active repo. On switch it broadcasts repoChanged; we bump seq
// (dropping every in-flight fetch for the old repo), clear ALL per-repo derived
// state (commits/selection/lane snapshot/collapse state — none of it is valid
// for the new repo), then refetch.
//
// gitStateChanged: the watcher tags each event with the owning repoPath. We
// only refresh when the event is for the current repo (or carries no repoPath,
// e.g. the global { scope: "all" } broadcasts from command handlers).
bridge.onEvent((event, data) => {
  if (event === "repoChanged") {
    const { repoPath } = (data ?? {}) as { repoPath?: string | null };
    const state = usePanelStore.getState();
    usePanelStore.setState({
      repoSeq: state.repoSeq + 1,
      currentRepoPath: repoPath ?? state.currentRepoPath,
      // Keep commits/visibleCommits/laneSnapshot/graphLayout until the new
      // repo's data lands. Clearing them here blanks the whole Git Log during
      // the slow getGraphData fetch, causing a visible flash. fetchInitialData
      // below replaces them atomically (see its set() call).
      loading: true,
      selectedCommitHash: null,
      selectedCommitHashes: [],
      lastSelectedCommitHash: null,
      collapsedSequenceIds: new Set(),
      collapsedIntermediates: new Map(),
      commitFiles: [],
      selectedFilePath: null,
      rangeOldest: null,
      rangeNewest: null,
      hasMore: true,
    });
    usePanelStore.getState().fetchInitialData();
    // Refresh badges for the new active repo (and the rest, in one round-trip).
    usePanelStore.getState().fetchRepoStatuses();
    return;
  }
  if (event === "gitStateChanged") {
    // Badges show EVERY repo's status, so refresh them on any repo's change
    // (the watcher already debounces 300ms, so a full round-trip is acceptable).
    // This runs before the current-repo filter below so a background repo's
    // ahead/dirty count updates even while viewing a different repo.
    usePanelStore.getState().fetchRepoStatuses();
    const { repoPath, scope, branch } = (data ?? {}) as {
      repoPath?: string;
      scope?: string;
      branch?: string;
    };

    // "Navigate Log to Branch Head": the host fans this out from the
    // navigateToHead command (single-click action in BranchTree). Resolve the
    // branch's head commit hash, select it, and set scrollTargetHash so
    // CommitList scrolls it into view. This is a scroll-only op — do NOT
    // refresh the graph (the commits are already loaded).
    if (scope === "navigateToHead" && branch) {
      const state = usePanelStore.getState();
      const branchInfo = state.branches.find((b) => b.name === branch);
      if (branchInfo?.lastCommitHash) {
        const headHash = branchInfo.lastCommitHash;
        usePanelStore.setState({
          selectedCommitHash: headHash,
          selectedCommitHashes: [headHash],
          lastSelectedCommitHash: headHash,
          scrollTargetHash: headHash,
        });
      }
      return;
    }

    // Multi-repo filter: only refresh the LOG for the current repo. Events
    // without repoPath (global command-handler broadcasts) are always honored.
    if (repoPath && repoPath !== usePanelStore.getState().currentRepoPath) {
      return;
    }
    usePanelStore.getState().refresh();
    return;
  }
  if (event === "showFileHistory") {
    const { file, repoPath } = data as { file: string; repoPath?: string };
    const state = usePanelStore.getState();
    // The host may switch the active repo (setCurrent → repoChanged) right
    // before this event. That repoChanged fetch shares a repoSeq with the
    // setFilter fetch below, so a slow repoChanged response (no file filter)
    // could clobber the correct one. Bump repoSeq + sync currentRepoPath so
    // the earlier fetches are dropped and setFilter's fetch — carrying both
    // repo and file filter — is authoritative.
    usePanelStore.setState({
      repoSeq: state.repoSeq + 1,
      currentRepoPath: repoPath ?? state.currentRepoPath,
    });
    usePanelStore.getState().setFilter({ file });
    // The seq bump also invalidates any in-flight fetchRepoStatuses from the
    // concurrent repoChanged; re-issue so chip badges stay fresh.
    usePanelStore.getState().fetchRepoStatuses();
  }
  if (event === "operationStart") {
    usePanelStore.setState({ operationInProgress: true });
  }
  if (event === "operationEnd") {
    usePanelStore.setState({ operationInProgress: false });
  }
});
