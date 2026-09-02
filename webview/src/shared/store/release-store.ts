import { create } from "zustand";
import { bridge } from "../bridge";
import { useCommitStore } from "./commit-store";

// ── Protocol shapes (mirror of the extension-side release handlers) ──────────

/** One publishable remote (github / gitee), pre-checked by the host. */
export interface ReleaseTarget {
  platform: "github" | "gitee";
  remoteName: string;
  owner: string;
  repo: string;
  configured: boolean;
  authOk: boolean;
  authHint?: string;
}

export interface ReleaseAttachment {
  path: string;
  size: number;
}

export interface ReleasePublishResult {
  platform: string;
  remoteName: string;
  success: boolean;
  url?: string;
  error?: string;
}

/** Cross-tab prefill payload (NewVersionResultPanel → ReleaseTab). */
export interface ReleasePrefill {
  tagName: string;
  version: string;
  title: string;
  notes: string;
  targetBranch: string;
}

export type ReleasePublishState = "idle" | "publishing" | "done";

/**
 * Gitee single-attachment cap. The community-observed limit is 100 MB
 * per file (undocumented by the API).
 */
export const GITEE_ATTACHMENT_LIMIT = 100 * 1024 * 1024;

export function isAttachmentOverLimit(attachment: ReleaseAttachment): boolean {
  return attachment.size > GITEE_ATTACHMENT_LIMIT;
}

/** B / KB / MB formatting for the attachment list. */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Stable key for a target's checkbox state. */
export function targetKey(platform: string, remoteName: string): string {
  return `${platform}:${remoteName}`;
}

/** Ready targets are checked by default; unconfigured ones stay off. */
function defaultSelected(targets: ReleaseTarget[]): string[] {
  return targets
    .filter((t) => t.configured && t.authOk)
    .map((t) => targetKey(t.platform, t.remoteName));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Swap the embedded old-tag occurrence in a hand-edited release title when
 * the user picks a different tag. Matches the full old tag first (e.g.
 * "v1.2.3"), then the bare version ("1.2.3"); v/V prefix on the old value is
 * optional so "Release 1.2.3" also updates. Returns the updated title, or
 * null when no tag-like occurrence was found (title stays untouched).
 */
export function swapTagInTitle(
  title: string,
  oldTag: string,
  newTag: string,
): string | null {
  const bare = (t: string) => t.replace(/^[vV]/, "");
  const oldFull = oldTag.trim();
  const oldBare = bare(oldFull);
  if (!oldBare || !newTag.trim()) return null;
  const replacement = newTag.trim();
  const replacementBare = bare(replacement);
  // Longest first so "v1.2.3" wins over "1.2.3".
  for (const [pattern, value] of [
    [oldFull, replacement],
    [oldBare, replacementBare],
  ] as const) {
    if (!pattern) continue;
    const re = new RegExp(
      `(?<![\\w.])${escapeRegExp(pattern)}(?![\\w.])`,
    );
    if (re.test(title)) {
      return title.replace(re, value);
    }
  }
  return null;
}

function defaultForm() {
  return {
    tagName: "",
    isNewTag: false,
    title: "",
    titleTouched: false,
    notes: "",
    notesTouched: false,
    targetBranch: "",
    prerelease: false,
    draft: false,
    attachments: [] as ReleaseAttachment[],
  };
}

interface ReleaseState {
  // Targets & refs (getRemoteReleaseTargets)
  targets: ReleaseTarget[];
  branches: string[];
  tags: string[];
  /** Keys ("platform:remoteName") of the checked publish targets. */
  selected: string[];
  loading: boolean;
  loadError: string | null;

  // Cross-tab prefill; consumed (and cleared) on ReleaseTab mount.
  prefill: ReleasePrefill | null;

  // Form
  tagName: string;
  isNewTag: boolean;
  title: string;
  /** True once the user edited the title by hand — later tag picks won't clobber. */
  titleTouched: boolean;
  notes: string;
  /** True once the user edited Notes by hand — later tag picks won't clobber. */
  notesTouched: boolean;
  targetBranch: string;
  prerelease: boolean;
  draft: boolean;
  attachments: ReleaseAttachment[];

  // Execution
  publishState: ReleasePublishState;
  results: ReleasePublishResult[];
  publishError: string | null;

  // Actions — lifecycle
  fetchTargets: () => Promise<void>;
  /** Clear the form only; targets/branches/tags stay loaded. */
  resetForm: () => void;
  reset: () => void;

  // Actions — prefill & targets
  setPrefill: (p: ReleasePrefill) => void;
  consumePrefill: () => void;
  toggleTarget: (platform: string, remoteName: string) => void;
  /** Host-side Gitee token input (showInputBox); refetches targets on success. */
  promptGiteeToken: () => Promise<void>;

  // Actions — form
  setTagMode: (isNewTag: boolean) => void;
  /** Pick an existing tag from the dropdown (also loads its changelog entry). */
  selectTag: (tagName: string) => void;
  /** Type a brand-new tag (input mode). */
  setTagName: (v: string) => void;
  setTitle: (v: string) => void;
  setNotes: (v: string) => void;
  setTargetBranch: (branch: string) => void;
  setPrerelease: (v: boolean) => void;
  setDraft: (v: boolean) => void;
  pickAttachments: () => Promise<void>;
  removeAttachment: (path: string) => void;
  clearAttachments: () => void;

  // Actions — execution
  publish: () => Promise<void>;
  /** Dismiss the result modal: back to idle with results cleared. */
  closeResults: () => void;
}

// ── Derived helpers (pure functions over the state) ─────────────────────────

export function releaseOverLimitAttachments(
  attachments: ReleaseAttachment[],
): ReleaseAttachment[] {
  return attachments.filter(isAttachmentOverLimit);
}

export function releaseHasGiteeSelected(state: {
  targets: ReleaseTarget[];
  selected: string[];
}): boolean {
  return state.targets.some(
    (t) =>
      t.platform === "gitee" &&
      state.selected.includes(targetKey(t.platform, t.remoteName)),
  );
}

/**
 * Publish gate: tag + title filled, at least one target checked, and no
 * oversized attachment while Gitee is among the checked targets.
 */
export function releaseCanPublish(state: ReleaseState): boolean {
  if (!state.tagName.trim() || !state.title.trim()) return false;
  if (state.selected.length === 0) return false;
  if (
    releaseHasGiteeSelected(state) &&
    releaseOverLimitAttachments(state.attachments).length > 0
  ) {
    return false;
  }
  return true;
}

/** Monotonic fetch counter — stale target responses are dropped (race guard). */
let fetchSeq = 0;
/** Repo path the loaded targets belong to (staleness guard on repo events). */
let loadedRepoPath: string | null = null;

export const useReleaseStore = create<ReleaseState>((set, get) => ({
  targets: [],
  branches: [],
  tags: [],
  selected: [],
  loading: false,
  loadError: null,
  prefill: null,
  ...defaultForm(),
  publishState: "idle",
  results: [],
  publishError: null,

  async fetchTargets() {
    const mySeq = ++fetchSeq;
    const repoPath = useCommitStore.getState().currentRepoPath;
    set({ loading: true, loadError: null });
    try {
      const result = (await bridge.request("getRemoteReleaseTargets", {
        repoPath,
      })) as {
        targets?: ReleaseTarget[];
        branches?: string[];
        tags?: string[];
      };
      if (mySeq !== fetchSeq) return;
      const targets = result?.targets ?? [];
      const branches = result?.branches ?? [];
      const tags = result?.tags ?? [];
      loadedRepoPath = repoPath;
      set((st) => ({
        targets,
        branches,
        tags,
        loading: false,
        selected: defaultSelected(targets),
        // Branch defaults to the current one (the host lists it first).
        targetBranch: st.targetBranch || branches[0] || "",
        // A prefilled/typed tag that already exists lands back in
        // "choose a tag" mode.
        isNewTag: st.isNewTag && !(st.tagName && tags.includes(st.tagName)),
      }));
    } catch (err) {
      if (mySeq !== fetchSeq) return;
      set({
        loading: false,
        loadError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  reset() {
    fetchSeq++;
    loadedRepoPath = null;
    set({
      ...defaultForm(),
      targets: [],
      branches: [],
      tags: [],
      selected: [],
      loading: false,
      loadError: null,
      prefill: get().prefill,
      publishState: "idle",
      results: [],
      publishError: null,
    });
  },

  /**
   * Clear the form only (post-publish "New Release" state): form fields
   * return to defaults, selection back to the ready targets, while the
   * loaded targets/branches/tags stay (no "No targets found" flash).
   */
  resetForm() {
    set((st) => ({
      ...defaultForm(),
      selected: defaultSelected(st.targets),
      // Branch default mirrors fetchTargets: the host lists the current
      // branch first.
      targetBranch: st.branches[0] ?? "",
    }));
  },

  setPrefill(p) {
    set({ prefill: p });
  },

  consumePrefill() {
    const p = get().prefill;
    if (!p) return;
    set({
      prefill: null,
      tagName: p.tagName,
      isNewTag: !get().tags.includes(p.tagName),
      title: p.title,
      // Prefilled title/notes are host content, not user edits — later tag
      // picks may still overwrite both (requirement 4 rule).
      titleTouched: false,
      notes: p.notes,
      notesTouched: false,
      targetBranch: p.targetBranch,
    });
  },

  toggleTarget(platform, remoteName) {
    const key = targetKey(platform, remoteName);
    set((st) => ({
      selected: st.selected.includes(key)
        ? st.selected.filter((k) => k !== key)
        : [...st.selected, key],
    }));
  },

  async promptGiteeToken() {
    try {
      // Cancelling the input box resolves configured:false — silent no-op.
      // The host blocks on showInputBox while the user pastes the token,
      // so the default 10s bridge timeout would fire mid-prompt — pass a
      // long tail like publish()'s createRelease call.
      const result = (await bridge.request(
        "promptGiteeToken",
        {},
        { timeout: 600_000 },
      )) as {
        configured?: boolean;
      };
      if (result?.configured) {
        void get().fetchTargets();
      }
    } catch (err) {
      // Bridge-level failure (e.g. timeout / SecretStorage error): surface
      // via the error banner instead of swallowing — otherwise the tab
      // silently keeps showing "Set Gitee Token" after a token was saved.
      set({
        loadError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setTagMode(isNewTag) {
    if (isNewTag === get().isNewTag) return;
    // Switching modes re-enters an empty tag state (dropdown unselected /
    // input cleared), mirroring GitHub's release page.
    set({ isNewTag, tagName: "" });
  },

  selectTag(tagName) {
    const prevTag = get().tagName;
    set({ tagName, isNewTag: false });
    if (!tagName) return;
    const s = get();
    if (!s.titleTouched) {
      set({ title: `v${tagName.replace(/^[vV]/, "")}` });
    } else if (prevTag) {
      // Hand-edited title: swap the embedded tag occurrence (full tag form
      // first, then bare version) so surrounding custom text survives.
      const swapped = swapTagInTitle(s.title, prevTag, tagName);
      if (swapped !== null) {
        set({ title: swapped });
      }
    }
    if (!tagName || get().notesTouched) {
      // Hand-edited notes are never clobbered by a tag re-pick.
      return;
    }
    void (async () => {
      try {
        const result = (await bridge.request("getChangelogEntryForTag", {
          tagName,
          repoPath: useCommitStore.getState().currentRepoPath,
        })) as { notes?: string };
        // Stale guard: another tag was picked (or mode switched) meanwhile.
        const s = get();
        if (s.isNewTag || s.tagName !== tagName || s.notesTouched) return;
        set({ notes: result?.notes ?? "" });
      } catch {
        // No changelog / no matching entry → keep notes as-is, no error.
      }
    })();
  },

  setTagName(v) {
    set({ tagName: v, isNewTag: true });
    if (!get().titleTouched && v.trim()) {
      set({ title: `v${v.trim().replace(/^[vV]/, "")}` });
    }
  },

  setTitle(v) {
    set({ title: v, titleTouched: true });
  },

  setNotes(v) {
    set({ notes: v, notesTouched: true });
  },

  setTargetBranch(branch) {
    set({ targetBranch: branch });
  },

  setPrerelease(v) {
    set({ prerelease: v });
  },

  setDraft(v) {
    set({ draft: v });
  },

  async pickAttachments() {
    try {
      // Cancelling the dialog resolves { attachments: [] } — silent no-op.
      const result = (await bridge.request(
        "selectReleaseAttachments",
        { repoPath: useCommitStore.getState().currentRepoPath },
        { timeout: 600_000 },
      )) as { attachments?: ReleaseAttachment[] };
      const picked = result?.attachments ?? [];
      if (picked.length === 0) return;
      set((st) => {
        // Append with silent full-path dedup.
        const seen = new Set(st.attachments.map((a) => a.path));
        const next = [...st.attachments];
        for (const a of picked) {
          if (seen.has(a.path)) continue;
          seen.add(a.path);
          next.push(a);
        }
        return { attachments: next };
      });
    } catch {
      // Bridge failure while picking → keep the current list silently.
    }
  },

  removeAttachment(path) {
    set((st) => ({
      attachments: st.attachments.filter((a) => a.path !== path),
    }));
  },

  clearAttachments() {
    set({ attachments: [] });
  },

  async publish() {
    const s = get();
    if (s.publishState === "publishing" || !releaseCanPublish(s)) return;
    // Snapshot the repo this publish belongs to. A repo switch mid-flight
    // (repoChanged/reposChanged → reset nulls or reassigns loadedRepoPath):
    // the stale response must not write back into the new repo's form.
    const repoAtStart = loadedRepoPath;
    const targets = s.targets
      .filter((t) => s.selected.includes(targetKey(t.platform, t.remoteName)))
      .map((t) => ({ platform: t.platform, remoteName: t.remoteName }));
    set({ publishState: "publishing", publishError: null, results: [] });
    try {
      const result = (await bridge.request(
        "createRelease",
        {
          repoPath: useCommitStore.getState().currentRepoPath,
          targets,
          tagName: s.tagName.trim(),
          isNewTag: s.isNewTag,
          title: s.title.trim(),
          notes: s.notes,
          targetBranch: s.targetBranch,
          prerelease: s.prerelease,
          draft: s.draft,
          attachments: s.attachments.map((a) => a.path),
        },
        // Per-platform release creation + attachment uploads — long tail.
        { timeout: 600_000 },
      )) as { results?: ReleasePublishResult[] };
      if (loadedRepoPath !== repoAtStart) return; // repo switched → dropped
      const results = result?.results ?? [];
      // "done" drives the result modal; an empty results array (shouldn't
      // happen — selected is non-empty) must not strand a stuck "done".
      set({
        publishState: results.length > 0 ? "done" : "idle",
        results,
      });
      // Fresh form for the next release while the result modal is up;
      // targets/branches/tags stay loaded (resetForm, not reset).
      get().resetForm();
    } catch (err) {
      if (loadedRepoPath !== repoAtStart) return; // repo switched → dropped
      // Bridge-level failure; per-platform failures arrive in results.
      set({
        publishState: "idle",
        publishError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  closeResults() {
    set({ publishState: "idle", results: [] });
  },
}));

// ── Event subscriptions ──────────────────────────────────────────────────────
// Repo switches invalidate targets/branches/tags wholesale: reset and reload
// when the tab is on screen (commit-store's listener owns currentRepoPath).
// Token changes only refresh auth state (fetchSeq guards fetch races).
bridge.onEvent((event, data) => {
  if (event === "giteeTokenChanged") {
    // Token saved/cleared in the host (tab prompt or the command palette
    // commands — the latter has no request/response channel): refresh
    // targets while the tab is on screen; a later mount refetches anyway.
    if (useCommitStore.getState().activeTab === "release") {
      void useReleaseStore.getState().fetchTargets();
    }
    return;
  }
  if (event === "repoChanged") {
    const { repoPath } = (data ?? {}) as { repoPath?: string | null };
    if ((repoPath ?? null) === loadedRepoPath) return;
  } else if (event === "reposChanged") {
    const { currentRepoPath } = (data ?? {}) as {
      currentRepoPath?: string | null;
    };
    if (!currentRepoPath || currentRepoPath === loadedRepoPath) return;
  } else {
    return;
  }
  useReleaseStore.getState().reset();
  if (useCommitStore.getState().activeTab === "release") {
    void useReleaseStore.getState().fetchTargets();
  }
});
