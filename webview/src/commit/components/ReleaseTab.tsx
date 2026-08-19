import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import {
  compareVersions,
  computeNextVersion,
  deriveVersionFromTag,
  isValidLooseSemver,
  resolveBaseVersion,
  useReleaseStore,
} from "../../shared/store/release-store";
import type { ReleaseContext } from "../../shared/store/release-store";
import { ChangelogSection } from "./ChangelogSection";
import { CommitRangeList } from "./CommitRangeList";
import { ModalOverlay } from "./PromptEditor";
import { ReleaseResultPanel } from "./ReleaseResultPanel";
import ArrowRightIcon from "~icons/codicon/arrow-right";
import CloseIcon from "~icons/codicon/close";
import ErrorIcon from "~icons/codicon/error";
import LoadingIcon from "~icons/codicon/loading";
import SparkleIcon from "~icons/codicon/sparkle";
import StopIcon from "~icons/codicon/debug-stop";
import WarningIcon from "~icons/codicon/warning";

/**
 * Layout mirrors the Commit tab's information architecture:
 *   .release-tab    — column, fills the panel (like .commit-tab-content)
 *   .release-scroll — flex-1 scroll area (pending commits)
 *   .release-bottom — fixed bottom bar (like .commit-message-area):
 *                     summary → version → changelog → action row.
 *   Success and create-confirmation are shown in modals (result panel,
 *   confirm dialog) rather than replacing the form inline.
 */
export function ReleaseTab() {
  const context = useReleaseStore((s) => s.context);
  const contextError = useReleaseStore((s) => s.contextError);
  const creating = useReleaseStore((s) => s.creating);
  // Working-tree changes: conflict guard for the Create button + the
  // uncommitted-changes warning in the confirmation card.
  const changes = useCommitStore((s) => s.changes);

  // Tab activation = component mount (App renders tabs conditionally):
  // fetch on first load, refetch when an event marked the context dirty.
  useEffect(() => {
    void useReleaseStore.getState().ensureLoaded();
  }, []);

  if (!context) {
    return (
      <div className="release-tab">
        <div className="release-scroll-center">
          {contextError ? (
            <div className="commit-error-banner" role="alert">
              <ErrorIcon className="commit-error-icon" />
              <span className="commit-error-message">
                {t("Failed to load release context")}
                {contextError ? `: ${contextError}` : ""}
              </span>
              <button
                type="button"
                className="commit-error-close"
                aria-label={t("Retry")}
                title={t("Retry")}
                onClick={() =>
                  void useReleaseStore.getState().fetchContext(true)
                }
              >
                <LoadingIcon />
              </button>
            </div>
          ) : (
            <LoadingIcon className="release-spin" />
          )}
        </div>
      </div>
    );
  }

  // Release landed: the result modal (ReleaseResultPanel) portals to
  // document.body; the form below stays intact behind it.
  return (
    <>
      <div className="release-tab" inert={creating ? true : undefined}>
        <div className="release-scroll">
          <CommitRangeList commits={context.commits} />
        </div>
        <div className="release-bottom">
          <ReleaseSummary context={context} />
          <VersionSection context={context} />
          <ChangelogSection context={context} />
          <CreateSection context={context} changes={changes} />
        </div>
      </div>
      <ReleaseResultPanel />
    </>
  );
}

// ─── Context summary (bottom bar, compact inline strip) ──────────────────────

function ReleaseSummary({ context }: { context: ReleaseContext }) {
  return (
    <div className="release-summary-bar">
      <div className="release-summary-inline">
        {/* Non-Node projects have no package.json version — the tag line
         * alone carries the version story then. */}
        {context.currentVersion != null && (
          <span className="release-summary-item">
            <span className="release-summary-k">{t("Current Version")}</span>
            <span className="release-summary-v release-mono">
              {context.currentVersion}
            </span>
          </span>
        )}
        <span className="release-summary-item">
          <span className="release-summary-k">{t("Latest Tag")}</span>
          <span className="release-summary-v release-mono">
            {context.lastTag ?? "—"}
          </span>
        </span>
      </div>
      {context.lastTagDetached && (
        <div className="release-summary-warn-inline" role="note">
          <WarningIcon />
          <span>
            {t(
              "Latest tag {0} is not on the current branch history. The list may contain older commits.",
              context.detachedTagName ?? "",
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Version (bottom bar, compact) ───────────────────────────────────────────
//
// One merged tag/version input is the single source of truth (e.g. "v1.6.4").
// The [Patch|Minor|Major] group acts as shortcut fillers + a recognition
// indicator: clicking a preset fills the input with `v{derivation}`; typing
// re-recognizes which preset (if any) the value matches and highlights it.
// No preset matches (prerelease tags, typos, no currentVersion) → the group
// simply shows no active segment.

function VersionSection({ context }: { context: ReleaseContext }) {
  const bump = useReleaseStore((s) => s.bump);
  const releaseTag = useReleaseStore((s) => s.releaseTag);
  const commitMessage = useReleaseStore((s) => s.commitMessage);
  const applyBump = useReleaseStore((s) => s.applyBump);
  const setReleaseTag = useReleaseStore((s) => s.setReleaseTag);
  const setCommitMessage = useReleaseStore((s) => s.setCommitMessage);

  // Derivations run off the base: package.json version, else the latest
  // tag's version. Null only when neither is usable.
  const baseVersion = resolveBaseVersion(context);
  const derived = deriveVersionFromTag(releaseTag);
  const formatInvalid = derived.length > 0 && !isValidLooseSemver(derived);
  const notHigher =
    !formatInvalid &&
    derived.length > 0 &&
    baseVersion != null &&
    (compareVersions(derived, baseVersion) ?? 1) <= 0;

  const bumpOptions = [
    { value: "major", label: t("Major") },
    { value: "minor", label: t("Minor") },
    { value: "patch", label: t("Patch") },
  ] as const;

  return (
    <section className="release-version-compact">
      <div className="release-version-controls">
        <div
          className="release-bump-group"
          role="radiogroup"
          aria-label={t("Version")}
          title={baseVersion ? undefined : t("No version base found")}
        >
          {bumpOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={bump === opt.value}
              disabled={!baseVersion}
              className={`release-bump-btn${bump === opt.value ? " active" : ""}${
                context.suggestedBump === opt.value ? " recommended" : ""
              }`}
              title={
                context.suggestedBump === opt.value
                  ? t("Recommended")
                  : undefined
              }
              onClick={() => applyBump(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          className="release-input release-mono release-version-input"
          value={releaseTag}
          onChange={(e) => setReleaseTag(e.target.value)}
          placeholder={
            baseVersion
              ? `v${computeNextVersion(baseVersion, context.suggestedBump) ?? "1.7.0"}`
              : "v1.7.0"
          }
          aria-label={t("Release Tag")}
          title={t("Release Tag")}
          spellCheck={false}
        />
      </div>

      <input
        className="release-input"
        value={commitMessage}
        placeholder={
          derived ? `chore(release): v${derived}` : "chore(release): v1.7.0"
        }
        aria-label={t("Commit Message")}
        title={t("Commit Message")}
        spellCheck={false}
        onChange={(e) => setCommitMessage(e.target.value)}
      />

      {formatInvalid && (
        <div className="release-hint-error">
          <ErrorIcon />
          {t("Invalid version format")}
        </div>
      )}
      {notHigher && (
        <div className="release-hint-warn">
          <WarningIcon />
          {t("Version is not higher than the current version")}
        </div>
      )}
    </section>
  );
}

// ─── Action row + create confirmation (bottom bar) ───────────────────────────

function CreateSection({
  context,
  changes,
}: {
  context: ReleaseContext;
  changes: WorkingTreeFile[];
}) {
  const releaseTag = useReleaseStore((s) => s.releaseTag);
  const commitMessage = useReleaseStore((s) => s.commitMessage);
  const updatePackageJson = useReleaseStore((s) => s.updatePackageJson);
  const setUpdatePackageJson = useReleaseStore((s) => s.setUpdatePackageJson);
  const changelogDraft = useReleaseStore((s) => s.changelogDraft);
  const confirmOpen = useReleaseStore((s) => s.confirmOpen);
  const creating = useReleaseStore((s) => s.creating);
  const createError = useReleaseStore((s) => s.createError);
  const setConfirmOpen = useReleaseStore((s) => s.setConfirmOpen);
  const createRelease = useReleaseStore((s) => s.createRelease);

  // AI generate (button lives here, next to Create Release).
  const generating = useReleaseStore((s) => s.generating);
  const generateChangelog = useReleaseStore((s) => s.generateChangelog);
  const cancelGeneration = useReleaseStore((s) => s.cancelGeneration);
  const aiConfigured = useCommitStore((s) => s.aiConfigured);

  // Elapsed timer while generating — rendered left of the Generate button
  // (CommitMessageArea pattern, condensed).
  const genStartRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  useEffect(() => {
    if (!generating) {
      genStartRef.current = null;
      setElapsed(null);
      return;
    }
    genStartRef.current = Date.now();
    setElapsed(null);
    const id = setInterval(() => {
      if (genStartRef.current != null) {
        const sec = Math.floor((Date.now() - genStartRef.current) / 1000);
        setElapsed(sec > 0 ? `${sec}s` : null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [generating]);

  // Version derives from the merged tag input (strip v/V); the tag itself
  // ships as typed. One field feeds both constraints.
  const version = deriveVersionFromTag(releaseTag);
  const trimmed = version.trim();
  const versionOk = trimmed.length > 0 && isValidLooseSemver(trimmed);
  const tagOk = releaseTag.trim().length > 0;
  const messageOk = commitMessage.trim().length > 0;
  // Nothing to release: no commits since the last tag → nothing to publish.
  const hasCommits = context.commits.length > 0;
  // Conflict guard (kept from the removed changes section): unresolved
  // conflicts block the release entirely.
  const conflicted = changes.some((f) => f.status === "conflicted");
  // Changelog draft is deliberately NOT part of this gate — a release may
  // ship without changelog changes (no file, or the user chose not to write).
  const canCreate = versionOk && tagOk && messageOk && hasCommits && !conflicted;

  // Disabled-reason tooltip: lists every missing field (multi-line bullet list).
  const missing: string[] = [];
  if (!versionOk) missing.push(t("Enter a valid version"));
  if (!tagOk) missing.push(t("Enter a tag name"));
  if (!messageOk) missing.push(t("Enter a commit message"));
  if (!hasCommits) missing.push(t("No commits to release since the last tag"));
  const createTitle = canCreate
    ? undefined
    : conflicted && missing.length === 0
      ? t("Resolve conflicts before creating a release")
      : `${t("Cannot create release:")}\n${missing.map((m) => `• ${m}`).join("\n")}`;

  // Release notes cover lastTag..HEAD commits only (the store always sends
  // includeFiles: []), so generation needs pending commits to work from.
  const canGenerate = aiConfigured && hasCommits;

  const handleGenerate = async () => {
    if (generating) {
      await cancelGeneration();
      return;
    }
    if (!canGenerate) return;
    await generateChangelog();
  };

  const generateTitle = generating
    ? t("Stop generating")
    : !aiConfigured
      ? t("AI is not configured")
      : !hasCommits
        ? t("No new commits since last version")
        : t("Generate with AI");

  // ── Confirmation modal (reuses the prompt editor's ModalOverlay) ──
  // Stays open while creating (both buttons disabled + loading state);
  // errors render inline; success closes it and the result card takes over.
  const confirmModal = confirmOpen && (
    <ModalOverlay
      onClose={() => {
        if (!creating) setConfirmOpen(false);
      }}
      ariaLabel={t("Confirm Release")}
    >
      {(() => {
        const updatesChangelog =
          context.changelogFile != null && changelogDraft.trim().length > 0;
        // Version files the release commit will actually carry (changelog +
        // package.json) — mirrors what createRelease writes/commits.
        const versionFileCount =
          (updatesChangelog ? 1 : 0) +
          (updatePackageJson && context.currentVersion ? 1 : 0);
        // Uncommitted working-tree files excluding the version files
        // themselves (they're written and committed by the release flow —
        // not "left behind").
        const uncommittedCount = changes.filter((f) => {
          if (f.path === "package.json") return false;
          if (context.changelogFile && f.path === context.changelogFile) return false;
          return true;
        }).length;
        return (
          <>
            <div className="release-modal-head">
              <span className="release-modal-title">{t("Confirm Release")}</span>
              <button
                type="button"
                className="commit-error-close"
                aria-label={t("Cancel")}
                disabled={creating}
                onClick={() => setConfirmOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="release-modal-rows">
              <div className="release-confirm-row">
                <span className="release-confirm-label">{t("Version")}</span>
                <span className="release-confirm-value release-mono">
                  {context.currentVersion ?? "—"}
                  <ArrowRightIcon className="release-version-arrow" />
                  <span className="release-version-new">{trimmed}</span>
                </span>
              </div>
              <div className="release-confirm-row">
                <span className="release-confirm-label">{t("Tag")}</span>
                <span className="release-confirm-value release-mono">
                  {releaseTag.trim()}
                </span>
              </div>
              <div className="release-confirm-row">
                <span className="release-confirm-label">{t("Commit Message")}</span>
                <span className="release-confirm-value">{commitMessage}</span>
              </div>
              <div className="release-confirm-row">
                <span className="release-confirm-label">{t("Files included")}</span>
                <span className="release-confirm-value">
                  {t("{0} file(s)", versionFileCount)}
                </span>
              </div>
              <div className="release-confirm-row">
                <span className="release-confirm-label">{t("Changelog")}</span>
                <span className="release-confirm-value">
                  {updatesChangelog ? t("Yes") : t("No")}
                </span>
              </div>
              {context.currentVersion && (
                <div className="release-confirm-row">
                  <span className="release-confirm-label">{t("package.json")}</span>
                  <span className="release-confirm-value">
                    {updatePackageJson ? t("Yes") : t("No")}
                  </span>
                </div>
              )}
            </div>

            {uncommittedCount > 0 && (
              <div className="release-confirm-warn" role="note">
                <WarningIcon />
                <span>
                  {t(
                    "{0} uncommitted change(s) detected. They will NOT be included in the release commit.",
                    uncommittedCount,
                  )}
                </span>
              </div>
            )}

            {createError && (
              <div className="commit-error-banner" role="alert">
                <ErrorIcon className="commit-error-icon" />
                <span className="commit-error-message">{createError}</span>
              </div>
            )}

            <div className="release-prompt-actions">
              <span className="release-prompt-spacer" />
              <button
                type="button"
                className="commit-btn commit-btn-secondary"
                disabled={creating}
                onClick={() => setConfirmOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="commit-btn commit-btn-primary"
                disabled={!canCreate || creating}
                onClick={() => void createRelease()}
              >
                {creating && <LoadingIcon className="release-spin" />}
                {creating ? t("Creating release...") : t("Confirm")}
              </button>
            </div>
          </>
        );
      })()}
    </ModalOverlay>
  );

  // ── Action row: [update package.json] … [Generate] [Create Release] ──
  return (
    <>
      {confirmModal}
      <div className="release-action-row">
      {context.currentVersion && (
        <label
          className="release-action-check"
          title={t("Update package.json version")}
        >
          <input
            type="checkbox"
            checked={updatePackageJson}
            onChange={(e) => setUpdatePackageJson(e.target.checked)}
          />
          {t("Update package.json version")}
        </label>
      )}
      <span className="release-action-spacer" />
      <div className="release-action-buttons">
        {generating && (
          <span className="release-elapsed" title={t("Generating changelog...")}>
            <LoadingIcon className="release-spin" />
            {elapsed}
          </span>
        )}
        <button
          type="button"
          className="commit-btn commit-btn-secondary release-generate-btn"
          disabled={!generating && !canGenerate}
          title={generateTitle}
          onClick={() => void handleGenerate()}
        >
          {generating ? (
            <StopIcon className="release-stop-icon" />
          ) : (
            <SparkleIcon />
          )}
          {generating ? t("Stop") : t("Generate")}
        </button>
        <button
          type="button"
          className="commit-btn commit-btn-primary"
          disabled={!canCreate}
          title={createTitle}
          onClick={() => {
            if (canCreate) setConfirmOpen(true);
          }}
        >
          {t("Create Release")}
        </button>
      </div>
      </div>
    </>
  );
}
