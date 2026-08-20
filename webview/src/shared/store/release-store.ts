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
 * Gitee single-attachment soft cap. The community-observed limit is 100 MB
 * per file (undocumented by the API); the check runs at 95 MB to leave
 * upload buffer.
 */
export const GITEE_ATTACHMENT_LIMIT = 95 * 1024 * 1024;

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
        // Ready targets are checked by default; unconfigured ones stay off.
        selected: targets
          .filter((t) => t.configured && t.authOk)
          .map((t) => targetKey(t.platform, t.remoteName)),
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
      const result = (await bridge.request("promptGiteeToken")) as {
        configured?: boolean;
      };
      if (result?.configured) {
        void get().fetchTargets();
      }
    } catch {
      // Bridge failure while prompting → stay silent.
    }
  },

  setTagMode(isNewTag) {
    if (isNewTag === get().isNewTag) return;
    // Switching modes re-enters an empty tag state (dropdown unselected /
    // input cleared), mirroring GitHub's release page.
    set({ isNewTag, tagName: "" });
  },

  selectTag(tagName) {
    set({ tagName, isNewTag: false });
    // Title follows the tag while the user hasn't edited it by hand.
    if (!get().titleTouched && tagName) {
      set({ title: `v${tagName.replace(/^[vV]/, "")}` });
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
      set({ publishState: "done", results: result?.results ?? [] });
    } catch (err) {
      if (loadedRepoPath !== repoAtStart) return; // repo switched → dropped
      // Bridge-level failure; per-platform failures arrive in results.
      set({
        publishState: "idle",
        publishError: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));

// ── Event subscriptions ──────────────────────────────────────────────────────
// Repo switches invalidate targets/branches/tags wholesale: reset and reload
// when the tab is on screen (commit-store's listener owns currentRepoPath).
bridge.onEvent((event, data) => {
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
