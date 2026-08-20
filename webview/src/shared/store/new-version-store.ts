import { create } from "zustand";
import { bridge } from "../bridge";
import { useCommitStore } from "./commit-store";

// ── Protocol shapes (mirror of the extension-side newVersion handlers) ──────────

export interface NewVersionCommit {
  hash: string;
  subject: string;
  author: string;
  shortDate: string;
}

export interface NewVersionContext {
  currentVersion: string | null;
  lastTag: string | null;
  /** true = 仓库有 tag 但均不在 HEAD 历史上（此时 lastTag 为 null、commits 全量）。 */
  lastTagDetached: boolean;
  /** lastTagDetached 时被跳过的"最新"tag 名（警告文案用）。 */
  detachedTagName?: string;
  commits: NewVersionCommit[];
  changelogFile: string | null;
  changelogLanguage: "zh" | "en";
  suggestedBump: "patch" | "minor" | "major";
  effectivePrompt: string;
  promptCustomized: boolean;
  aiConfigured: boolean;
}

export interface NewVersionResult {
  commitHash: string;
  tagName: string;
  version: string;
  updatedFiles: string[];
}

/**
 * Version-form state for the merged tag input. The tag field is the single
 * source of truth; `bump` is a RECOGNITION indicator derived from the tag
 * (which preset, if any, the tag's version matches) — "none" when it
 * matches no preset derivation, the tag is unparseable, or there is no
 * currentVersion to derive from.
 */
export type BumpChoice = "patch" | "minor" | "major" | "none";

// ── Version helpers ──────────────────────────────────────────────────────────

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/** Loose semver: `1.7.0`, `v1.7.0`, `1.7.0-beta.1`, `1.7.0+build.3`. */
export function parseVersion(v: string): ParsedVersion | null {
  const m = v
    .trim()
    .match(
      /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.+-]+))?(?:\+[0-9A-Za-z.+-]+)?$/,
    );
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

export function isValidLooseSemver(v: string): boolean {
  return parseVersion(v) !== null;
}

/** -1 / 0 / 1, or null when either side is unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const byCore =
    Math.sign(pa.major - pb.major) ||
    Math.sign(pa.minor - pb.minor) ||
    Math.sign(pa.patch - pb.patch);
  if (byCore !== 0) return byCore;
  // Equal cores: a final version outranks any of its own prereleases.
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease === pb.prerelease ? 0 : pa.prerelease < pb.prerelease ? -1 : 1;
  }
  if (pa.prerelease) return -1;
  if (pb.prerelease) return 1;
  return 0;
}

export function computeNextVersion(
  current: string | null,
  bump: "patch" | "minor" | "major",
): string | null {
  const p = current ? parseVersion(current) : null;
  if (!p) return null;
  switch (bump) {
    case "patch":
      // Prerelease (1.6.3-beta.1) + patch semantically means "finalize":
      // strip the suffix instead of incrementing.
      return p.prerelease
        ? `${p.major}.${p.minor}.${p.patch}`
        : `${p.major}.${p.minor}.${p.patch + 1}`;
    case "minor":
      return `${p.major}.${p.minor + 1}.0`;
    case "major":
      return `${p.major + 1}.0.0`;
  }
}

/** Strip the optional v/V prefix from a tag and trim → the version string. */
export function deriveVersionFromTag(tag: string): string {
  return tag.trim().replace(/^[vV]/, "");
}

/**
 * Version base for derivations: package.json's version when present,
 * otherwise the latest tag's version (strip v/V, must pass loose semver).
 * Null when neither yields a usable base (no package.json AND no versioned
 * tag) — presets are disabled and everything defaults to manual entry.
 */
export function resolveBaseVersion(ctx: {
  currentVersion: string | null;
  lastTag: string | null;
}): string | null {
  if (ctx.currentVersion && isValidLooseSemver(ctx.currentVersion)) {
    return ctx.currentVersion;
  }
  if (ctx.lastTag) {
    const fromTag = deriveVersionFromTag(ctx.lastTag);
    if (fromTag && isValidLooseSemver(fromTag)) return fromTag;
  }
  return null;
}

/**
 * Which preset the tag's version corresponds to (compares against each
 * preset's derivation from the base version). Unparseable, prerelease
 * suffixes, or a missing base all yield "none".
 */
export function locateBump(tag: string, baseVersion: string | null): BumpChoice {
  const derived = deriveVersionFromTag(tag);
  if (!derived || !isValidLooseSemver(derived) || !baseVersion) return "none";
  for (const b of ["patch", "minor", "major"] as const) {
    if (computeNextVersion(baseVersion, b) === derived) return b;
  }
  return "none";
}

// ── Store ────────────────────────────────────────────────────────────────────

function defaultForm() {
  return {
    bump: "none" as BumpChoice,
    versionTag: "",
    commitMessage: "",
    commitMessageTouched: false,
    updatePackageJson: false,
    changelogDraft: "",
    /** User-picked changelog language; null = use the detected one. */
    changelogLanguageOverride: null as "zh" | "en" | null,
    promptOpen: false,
    promptDraft: "",
    promptError: null as string | null,
    confirmOpen: false,
  };
}

interface NewVersionState {
  // Context
  context: NewVersionContext | null;
  /** Repo path the loaded context belongs to (staleness guard on repo events). */
  contextRepoPath: string | null;
  loading: boolean;
  dirty: boolean;
  contextError: string | null;

  // Form
  bump: BumpChoice;
  /** Merged tag/version field — the single version entry (e.g. "v1.6.4"). */
  versionTag: string;
  commitMessage: string;
  commitMessageTouched: boolean;
  updatePackageJson: boolean;
  changelogDraft: string;
  /** User-picked changelog language; null = use the detected one. */
  changelogLanguageOverride: "zh" | "en" | null;
  promptOpen: boolean;
  promptDraft: string;
  promptError: string | null;
  confirmOpen: boolean;

  // Changelog generation
  generating: boolean;
  genCancelling: boolean;
  genError: string | null;

  // Execution
  creating: boolean;
  createError: string | null;
  result: NewVersionResult | null;
  /** Version before the new version (for the result panel's old → new display). */
  fromVersion: string | null;
  pushing: boolean;
  pushed: boolean;
  pushError: string | null;

  // Actions — context lifecycle
  fetchContext: (resetForm: boolean) => Promise<void>;
  ensureLoaded: () => Promise<void>;
  markDirty: () => void;
  resetAll: () => void;
  resetForm: (ctx: NewVersionContext) => void;
  applyChangelogFile: (file: string, language?: "zh" | "en") => void;

  // Actions — form
  /** Preset shortcut: fill the tag with `v{derivation}` and mark it active. */
  applyBump: (bump: "patch" | "minor" | "major") => void;
  /** User typed into the tag field: store it and re-recognize the preset. */
  setVersionTag: (v: string) => void;
  setCommitMessage: (v: string) => void;
  setUpdatePackageJson: (v: boolean) => void;
  setChangelogDraft: (v: string) => void;
  /** Override the detected changelog language (null = back to detected). */
  setChangelogLanguageOverride: (lang: "zh" | "en" | null) => void;
  setPromptOpen: (open: boolean) => void;
  setPromptDraft: (v: string) => void;
  setPromptError: (e: string | null) => void;
  setGenError: (e: string | null) => void;
  savePrompt: () => Promise<void>;
  restorePrompt: () => Promise<void>;
  setConfirmOpen: (open: boolean) => void;

  // Actions — execution
  generateChangelog: () => Promise<void>;
  cancelGeneration: () => Promise<void>;
  createNewVersion: () => Promise<void>;
  pushCreatedNewVersion: () => Promise<void>;
  finish: () => Promise<void>;
  locateCommit: (hash: string) => void;
}

/** Monotonic fetch counter — stale context responses are dropped (race guard). */
let fetchSeq = 0;
/** Set when a dirty-marking event arrives while a fetch is in flight. */
let pendingRefetch = false;

export const useNewVersionStore = create<NewVersionState>((set, get) => ({
  context: null,
  contextRepoPath: null,
  loading: false,
  dirty: false,
  contextError: null,
  ...defaultForm(),
  generating: false,
  genCancelling: false,
  genError: null,
  creating: false,
  createError: null,
  result: null,
  fromVersion: null,
  pushing: false,
  pushed: false,
  pushError: null,

  // ── Context lifecycle ──────────────────────────────────────────
  async fetchContext(resetForm) {
    const mySeq = ++fetchSeq;
    const repoPath = useCommitStore.getState().currentRepoPath;
    set({ loading: true, contextError: null });
    try {
      const ctx = (await bridge.request("getNewVersionContext", {
        repoPath,
      })) as NewVersionContext;
      if (mySeq !== fetchSeq) return;
      set({ context: ctx, contextRepoPath: repoPath, dirty: false, loading: false });
      if (resetForm) get().resetForm(ctx);
    } catch (err) {
      if (mySeq !== fetchSeq) return;
      set({
        loading: false,
        contextError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (mySeq === fetchSeq && pendingRefetch) {
        // A git event landed while this fetch was in flight — the response
        // may predate it. Fetch once more.
        pendingRefetch = false;
        if (useCommitStore.getState().activeTab === "newVersion") {
          void get().fetchContext(false);
        }
      }
    }
  },

  async ensureLoaded() {
    // Wait for the commit store's ready handshake so the first context fetch
    // carries a real repoPath instead of null.
    if (!useCommitStore.getState().repoInitialized) {
      await new Promise<void>((resolve) => {
        let unsub: () => void = () => {};
        const timer = setTimeout(done, 5000);
        function done() {
          clearTimeout(timer);
          unsub();
          resolve();
        }
        unsub = useCommitStore.subscribe((s, prev) => {
          if (s.repoInitialized && !prev.repoInitialized) done();
        });
      });
    }
    const s = get();
    if (s.loading || s.creating) return;
    if (s.context && !s.dirty) return;
    // First load always resets; a dirty reload keeps the result panel intact
    // (the just-created version shouldn't be wiped by its own tag events).
    const reset = s.context === null || !s.result;
    await get().fetchContext(reset);
  },

  markDirty() {
    set({ dirty: true });
    const s = get();
    if (s.loading || s.creating) {
      pendingRefetch = true;
      return;
    }
    // Tab is on screen → live-refresh the context without clobbering the form.
    if (useCommitStore.getState().activeTab === "newVersion") {
      void get().fetchContext(false);
    }
  },

  resetAll() {
    if (get().generating) {
      void bridge.request("cancelNewVersionChangelogGeneration").catch(() => {});
    }
    fetchSeq++;
    pendingRefetch = false;
    set({
      ...defaultForm(),
      context: null,
      contextRepoPath: useCommitStore.getState().currentRepoPath,
      loading: false,
      dirty: true,
      contextError: null,
      generating: false,
      genCancelling: false,
      genError: null,
      creating: false,
      createError: null,
      result: null,
      fromVersion: null,
      pushing: false,
      pushed: false,
      pushError: null,
    });
  },

  resetForm(ctx) {
    // Base falls back to the latest tag for non-Node projects (no
    // package.json version); presets and seeding both run off it.
    const baseVersion = resolveBaseVersion(ctx);
    const nextVersion = computeNextVersion(baseVersion, ctx.suggestedBump);
    set({
      ...defaultForm(),
      // Seed the tag with the recommended derivation; the recognition
      // indicator naturally lands on suggestedBump. No usable base at all
      // → nothing to derive, tag starts empty ("none").
      bump: nextVersion ? ctx.suggestedBump : "none",
      versionTag: nextVersion ? `v${nextVersion}` : "",
      commitMessage: nextVersion ? `chore(release): v${nextVersion}` : "",
      // package.json updating only applies where a version field exists.
      updatePackageJson: ctx.currentVersion != null,
      promptDraft: ctx.effectivePrompt,
    });
  },

  applyChangelogFile(file, language) {
    set((st) => ({
      context: st.context
        ? {
            ...st.context,
            changelogFile: file,
            // initNewVersionChangelog 按表单选择的语言建文件，语言角标同步为该值。
            ...(language ? { changelogLanguage: language } : {}),
          }
        : st.context,
    }));
  },

  // ── Form ───────────────────────────────────────────────────────
  applyBump(bump) {
    const ctx = get().context;
    const next = computeNextVersion(
      ctx ? resolveBaseVersion(ctx) : null,
      bump,
    );
    if (!next) return;
    set({ versionTag: `v${next}`, bump });
    rederiveMessage(get, set);
  },

  setVersionTag(v) {
    const ctx = get().context;
    set({
      versionTag: v,
      bump: locateBump(v, ctx ? resolveBaseVersion(ctx) : null),
    });
    rederiveMessage(get, set);
  },

  setCommitMessage(v) {
    set({ commitMessage: v, commitMessageTouched: true });
  },

  setUpdatePackageJson(v) {
    set({ updatePackageJson: v });
  },

  setChangelogDraft(v) {
    set({ changelogDraft: v });
  },

  setChangelogLanguageOverride(lang) {
    set({ changelogLanguageOverride: lang });
  },

  setPromptOpen(open) {
    set({ promptOpen: open });
  },

  setPromptDraft(v) {
    set({ promptDraft: v });
  },

  setPromptError(e) {
    set({ promptError: e });
  },

  setGenError(e) {
    set({ genError: e });
  },

  async savePrompt() {
    // Empty value = restore default (protocol contract).
    const value = get().promptDraft.trim();
    try {
      const result = (await bridge.request("updateNewVersionPrompt", {
        value,
      })) as { effectivePrompt?: string; promptCustomized?: boolean };
      set((st) => ({
        promptDraft: result?.effectivePrompt ?? st.promptDraft,
        context: st.context
          ? {
              ...st.context,
              effectivePrompt: result?.effectivePrompt ?? st.context.effectivePrompt,
              promptCustomized: result?.promptCustomized ?? st.context.promptCustomized,
            }
          : st.context,
      }));
    } catch (err) {
      set({
        promptError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async restorePrompt() {
    try {
      const result = (await bridge.request("updateNewVersionPrompt", {
        value: "",
      })) as { effectivePrompt?: string; promptCustomized?: boolean };
      set((st) => ({
        promptDraft: result?.effectivePrompt ?? st.promptDraft,
        context: st.context
          ? {
              ...st.context,
              effectivePrompt: result?.effectivePrompt ?? st.context.effectivePrompt,
              promptCustomized: result?.promptCustomized ?? st.context.promptCustomized,
            }
          : st.context,
      }));
    } catch (err) {
      set({
        promptError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setConfirmOpen(open) {
    set({ confirmOpen: open, createError: null });
  },

  // ── Execution ──────────────────────────────────────────────────
  async generateChangelog() {
    const s = get();
    if (s.generating || !s.context) return;
    const repoAtStart = useCommitStore.getState().currentRepoPath;
    // Generated notes cover lastTag..HEAD only — uncommitted working-tree
    // content is not part of the version, so includeFiles is always empty.
    set({ generating: true, genCancelling: false, genError: null });
    try {
      const result = (await bridge.request(
        "generateNewVersionChangelog",
        {
          includeFiles: [],
          // Manual language pick wins; omitted → host uses the detected one.
          ...(s.changelogLanguageOverride
            ? { language: s.changelogLanguageOverride }
            : {}),
        },
        { timeout: (useCommitStore.getState().aiTimeout + 10) * 1000 },
      )) as { changelog?: string };
      // Repo switched mid-generation → discard.
      if (useCommitStore.getState().currentRepoPath !== repoAtStart) return;
      set({ changelogDraft: result?.changelog ?? "" });
    } catch (err) {
      if (get().genCancelling) return; // user-cancelled → stay silent
      if (useCommitStore.getState().currentRepoPath !== repoAtStart) return;
      set({ genError: err instanceof Error ? err.message : String(err) });
    } finally {
      if (useCommitStore.getState().currentRepoPath === repoAtStart) {
        set({ generating: false, genCancelling: false });
      }
    }
  },

  async cancelGeneration() {
    if (!get().generating) return;
    set({ genCancelling: true });
    try {
      await bridge.request("cancelNewVersionChangelogGeneration");
    } catch {
      // ignore — the generation request will still return and clear state
    }
  },

  async createNewVersion() {
    const s = get();
    if (s.creating || !s.context) return;
    // Version derives from the tag (strip v/V); the tag itself ships as typed.
    const version = deriveVersionFromTag(s.versionTag);
    const tagName = s.versionTag.trim();
    if (!version || !isValidLooseSemver(version) || !tagName) return;
    set({ creating: true, createError: null });
    try {
      const result = (await bridge.request(
        "createNewVersion",
        {
          version,
          tagName,
          commitMessage: s.commitMessage.trim() || `chore(release): v${version}`,
          changelogEntry: s.changelogDraft,
          // Forced false without a package.json version field — the checkbox
          // is hidden in that case and the state must not leak stale true.
          updatePackageJson:
            s.context.currentVersion != null ? s.updatePackageJson : false,
          // versionOnly + empty includePaths: the version commit carries
          // only the version files (changelog / package.json). Omitted —
          // the handler defaults to exactly this behavior.
        },
        { timeout: 60_000 },
      )) as NewVersionResult;
      set({
        creating: false,
        result,
        confirmOpen: false,
        fromVersion: s.context.currentVersion,
      });
      // Panel contract: refresh the commit area + git state right away
      // (refresh() = host refreshGitState + fetchChanges + fetchStashes).
      void useCommitStore.getState().refresh();
    } catch (err) {
      // No auto-rollback — surface the error inline, the form stays intact.
      set({
        creating: false,
        createError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async pushCreatedNewVersion() {
    const s = get();
    if (!s.result || s.pushing || s.pushed) return;
    set({ pushing: true, pushError: null });
    try {
      await bridge.request(
        "pushNewVersion",
        { tagName: s.result.tagName },
        { timeout: 60_000 },
      );
      set({ pushing: false, pushed: true });
    } catch (err) {
      set({
        pushing: false,
        pushError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async finish() {
    fetchSeq++;
    pendingRefetch = false;
    set({
      ...defaultForm(),
      result: null,
      fromVersion: null,
      pushing: false,
      pushed: false,
      pushError: null,
      createError: null,
      dirty: true,
    });
    await get().fetchContext(true);
  },

  locateCommit(hash) {
    void bridge.request("locateCommit", { hash }).catch(() => {});
  },
}));

/**
 * The commit message default follows the version derived from the tag
 * until the user edits the message by hand (commitMessageTouched decouples).
 */
function rederiveMessage(
  get: () => NewVersionState,
  set: (partial: Partial<NewVersionState>) => void,
): void {
  const s = get();
  if (s.commitMessageTouched) return;
  const version = deriveVersionFromTag(s.versionTag);
  set({ commitMessage: version ? `chore(release): v${version}` : "" });
}

// ── Event subscriptions ──────────────────────────────────────────────────────
// Mirrors commit-store's pattern: repo-scoped events are filtered by repoPath;
// repo switches hard-reset the panel, everything else just marks it dirty.
// (commit-store's own listener runs first — it owns currentRepoPath truth.)
bridge.onEvent((event, data) => {
  const st = useNewVersionStore.getState();

  if (event === "repoChanged") {
    const { repoPath } = (data ?? {}) as { repoPath?: string | null };
    if ((repoPath ?? null) === st.contextRepoPath && st.context) return;
    st.resetAll();
    if (useCommitStore.getState().activeTab === "newVersion") {
      void useNewVersionStore.getState().fetchContext(true);
    }
    return;
  }

  if (event === "reposChanged") {
    // commit-store may have adopted a new active repo without broadcasting
    // repoChanged — compare against the repo our context was loaded for.
    const active = useCommitStore.getState().currentRepoPath;
    if (active && active !== st.contextRepoPath) {
      st.resetAll();
      if (useCommitStore.getState().activeTab === "newVersion") {
        void useNewVersionStore.getState().fetchContext(true);
      }
    }
    return;
  }

  if (event === "aiConfigChanged") {
    // aiConfigured lives in the context; refetch when the tab is on screen
    // (commit-store refreshes its own aiConfigured independently).
    if (st.context && useCommitStore.getState().activeTab === "newVersion") {
      void useNewVersionStore.getState().fetchContext(false);
    }
    return;
  }

  if (event === "gitStateChanged" || event === "commitStateChanged") {
    const { repoPath } = (data ?? {}) as { repoPath?: string };
    // Multi-repo filter: only honor events for the current repo (global
    // broadcasts without repoPath always pass).
    if (repoPath && repoPath !== useCommitStore.getState().currentRepoPath) {
      return;
    }
    st.markDirty();
    return;
  }
});
