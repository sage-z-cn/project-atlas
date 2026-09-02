import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import {
  compareVersions,
  computeNextVersion,
  deriveVersionFromTag,
  isValidLooseSemver,
  resolveBaseVersion,
  useNewVersionStore,
} from "../../shared/store/new-version-store";
import type { NewVersionContext } from "../../shared/store/new-version-store";
import { ChangelogSection } from "./ChangelogSection";
import { CommitRangeList } from "./CommitRangeList";
import { ModalOverlay } from "./Modal";
import { NewVersionResultPanel } from "./NewVersionResultPanel";
import ArrowRightIcon from "~icons/codicon/arrow-right";
import CloseIcon from "~icons/codicon/close";
import ErrorIcon from "~icons/codicon/error";
import LoadingIcon from "~icons/codicon/loading";
import SparkleIcon from "~icons/codicon/sparkle";
import StopIcon from "~icons/codicon/debug-stop";
import WarningIcon from "~icons/codicon/warning";

/**
 * Layout mirrors the Commit tab's information architecture:
 *   .new-version-tab    — column, fills the panel (like .commit-tab-content)
 *   .new-version-scroll — flex-1 scroll area (pending commits)
 *   .new-version-bottom — fixed bottom bar (like .commit-message-area):
 *                     summary → version → changelog → action row.
 *   Success and create-confirmation are shown in modals (result panel,
 *   confirm dialog) rather than replacing the form inline.
 */
export function NewVersionTab() {
  const context = useNewVersionStore((s) => s.context);
  const contextError = useNewVersionStore((s) => s.contextError);
  const creating = useNewVersionStore((s) => s.creating);
  // Working-tree changes: conflict guard for the Create button + the
  // uncommitted-changes warning in the confirmation card.
  const changes = useCommitStore((s) => s.changes);

  // Tab activation = component mount (App renders tabs conditionally):
  // fetch on first load, refetch when an event marked the context dirty.
  useEffect(() => {
    void useNewVersionStore.getState().ensureLoaded();
  }, []);

  if (!context) {
    return (
      <div className="new-version-tab">
        <div className="new-version-scroll-center">
          {contextError ? (
            <div className="commit-error-banner" role="alert">
              <ErrorIcon className="commit-error-icon" />
              <span className="commit-error-message">
                {t("Failed to load new version context")}
                {contextError ? `: ${contextError}` : ""}
              </span>
              <button
                type="button"
                className="commit-error-close"
                aria-label={t("Retry")}
                title={t("Retry")}
                onClick={() =>
                  void useNewVersionStore.getState().fetchContext(true)
                }
              >
                <LoadingIcon />
              </button>
            </div>
          ) : (
            <LoadingIcon className="new-version-spin" />
          )}
        </div>
      </div>
    );
  }

  // New version landed: the result modal (NewVersionResultPanel) portals to
  // document.body; the form below stays intact behind it.
  return (
    <>
      <div className="new-version-tab" inert={creating ? true : undefined}>
        <div className="new-version-scroll">
          <CommitRangeList commits={context.commits} />
        </div>
        <div className="new-version-bottom">
          <NewVersionSummary context={context} />
          <VersionSection context={context} />
          <ChangelogSection context={context} />
          <CreateSection context={context} changes={changes} />
        </div>
      </div>
      <NewVersionResultPanel />
    </>
  );
}

// ─── Context summary (bottom bar, compact inline strip) ──────────────────────

function NewVersionSummary({ context }: { context: NewVersionContext }) {
  return (
    <div className="new-version-summary-bar">
      <div className="new-version-summary-inline">
        {/* Non-Node projects have no package.json version — the tag line
         * alone carries the version story then. */}
        {context.currentVersion != null && (
          <span className="new-version-summary-item">
            <span className="new-version-summary-k">{t("Current Version")}</span>
            <span className="new-version-summary-v new-version-mono">
              {context.currentVersion}
            </span>
          </span>
        )}
        <span className="new-version-summary-item">
          <span className="new-version-summary-k">{t("Latest Tag")}</span>
          <span className="new-version-summary-v new-version-mono">
            {context.lastTag ?? "—"}
          </span>
        </span>
      </div>
      {context.lastTagDetached && (
        <div className="new-version-summary-warn-inline" role="note">
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

function VersionSection({ context }: { context: NewVersionContext }) {
  const bump = useNewVersionStore((s) => s.bump);
  const versionTag = useNewVersionStore((s) => s.versionTag);
  const baselineVersion = useNewVersionStore((s) => s.baselineVersion);
  const commitMessage = useNewVersionStore((s) => s.commitMessage);
  const applyBump = useNewVersionStore((s) => s.applyBump);
  const setVersionTag = useNewVersionStore((s) => s.setVersionTag);
  const setCommitMessage = useNewVersionStore((s) => s.setCommitMessage);

  // Derivations run off the base: package.json version, else the latest
  // tag's version. Null only when neither is usable.
  const baseVersion = resolveBaseVersion(context);
  const derived = deriveVersionFromTag(versionTag);
  const formatInvalid = derived.length > 0 && !isValidLooseSemver(derived);
  // "Not higher" compares against the session baseline (snapshotted when
  // the form was seeded), not the live base: creating the version bumps
  // currentVersion mid-session and must not flag the already-entered
  // value. Normal sessions: baseline === live base, behavior unchanged.
  const compareBase = baselineVersion ?? baseVersion;
  const notHigher =
    !formatInvalid &&
    derived.length > 0 &&
    compareBase != null &&
    (compareVersions(derived, compareBase) ?? 1) <= 0;

  const bumpOptions = [
    { value: "major", label: t("Major") },
    { value: "minor", label: t("Minor") },
    { value: "patch", label: t("Patch") },
  ] as const;

  return (
    <section className="new-version-version-compact">
      <div className="new-version-version-controls">
        <div
          className="new-version-bump-group"
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
              className={`new-version-bump-btn${bump === opt.value ? " active" : ""}${
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
          className="new-version-input new-version-mono new-version-version-input"
          value={versionTag}
          onChange={(e) => setVersionTag(e.target.value)}
          placeholder={
            baseVersion
              ? `v${computeNextVersion(baseVersion, context.suggestedBump) ?? "1.7.0"}`
              : "v1.7.0"
          }
          aria-label={t("New Version Tag")}
          title={t("New Version Tag")}
          spellCheck={false}
        />
      </div>

      <input
        className="new-version-input"
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
        <div className="new-version-hint-error">
          <ErrorIcon />
          {t("Invalid version format")}
        </div>
      )}
      {notHigher && (
        <div className="new-version-hint-warn">
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
  context: NewVersionContext;
  changes: WorkingTreeFile[];
}) {
  const versionTag = useNewVersionStore((s) => s.versionTag);
  const commitMessage = useNewVersionStore((s) => s.commitMessage);
  const updatePackageJson = useNewVersionStore((s) => s.updatePackageJson);
  const setUpdatePackageJson = useNewVersionStore((s) => s.setUpdatePackageJson);
  const changelogDraft = useNewVersionStore((s) => s.changelogDraft);
  const confirmOpen = useNewVersionStore((s) => s.confirmOpen);
  const creating = useNewVersionStore((s) => s.creating);
  const createError = useNewVersionStore((s) => s.createError);
  const setConfirmOpen = useNewVersionStore((s) => s.setConfirmOpen);
  const createNewVersion = useNewVersionStore((s) => s.createNewVersion);

  // AI generate (icon lives in the checkbox row, right-aligned — the same
  // position as the commit panel's AI button in its amend row).
  const generating = useNewVersionStore((s) => s.generating);
  const generateChangelog = useNewVersionStore((s) => s.generateChangelog);
  const cancelGeneration = useNewVersionStore((s) => s.cancelGeneration);
  const aiConfigured = useCommitStore((s) => s.aiConfigured);

  // Elapsed timer while generating — rendered left of the AI icon
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
  const version = deriveVersionFromTag(versionTag);
  const trimmed = version.trim();
  const versionOk = trimmed.length > 0 && isValidLooseSemver(trimmed);
  const tagOk = versionTag.trim().length > 0;
  const messageOk = commitMessage.trim().length > 0;
  // No new version possible: no commits since the last tag → nothing to publish.
  const hasCommits = context.commits.length > 0;
  // Conflict guard (kept from the removed changes section): unresolved
  // conflicts block the new version entirely.
  const conflicted = changes.some((f) => f.status === "conflicted");
  // Changelog draft is deliberately NOT part of this gate — a new version may
  // ship without changelog changes (no file, or the user chose not to write).
  const canCreate = versionOk && tagOk && messageOk && hasCommits && !conflicted;

  // Disabled-reason tooltip: lists every missing field (multi-line bullet list).
  const missing: string[] = [];
  if (!versionOk) missing.push(t("Enter a valid version"));
  if (!tagOk) missing.push(t("Enter a tag name"));
  if (!messageOk) missing.push(t("Enter a commit message"));
  if (!hasCommits) missing.push(t("No commits to include since the last tag"));
  const createTitle = canCreate
    ? undefined
    : conflicted && missing.length === 0
      ? t("Resolve conflicts before creating a new version")
      : `${t("Cannot create new version:")}\n${missing.map((m) => `• ${m}`).join("\n")}`;

  // ── Confirmation modal (reuses the prompt editor's ModalOverlay) ──
  // Stays open while creating (both buttons disabled + loading state);
  // errors render inline; success closes it and the result card takes over.
  const confirmModal = confirmOpen && (
    <ModalOverlay
      onClose={() => {
        if (!creating) setConfirmOpen(false);
      }}
      ariaLabel={t("Confirm New Version")}
    >
      {(() => {
        const updatesChangelog =
          context.changelogFile != null && changelogDraft.trim().length > 0;
        // Version files the version commit will actually carry (changelog +
        // package.json) — mirrors what createNewVersion writes/commits.
        const versionFileCount =
          (updatesChangelog ? 1 : 0) +
          (updatePackageJson && context.currentVersion ? 1 : 0);
        // Uncommitted working-tree files excluding the version files
        // themselves (they're written and committed by the new version flow —
        // not "left behind").
        const uncommittedCount = changes.filter((f) => {
          if (f.path === "package.json") return false;
          if (context.changelogFile && f.path === context.changelogFile) return false;
          return true;
        }).length;
        return (
          <>
            <div className="new-version-modal-head">
              <span className="new-version-modal-title">{t("Confirm New Version")}</span>
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

            <div className="new-version-modal-rows">
              <div className="new-version-confirm-row">
                <span className="new-version-confirm-label">{t("Version")}</span>
                <span className="new-version-confirm-value new-version-mono">
                  {context.currentVersion ?? "—"}
                  <ArrowRightIcon className="new-version-version-arrow" />
                  <span className="new-version-version-new">{trimmed}</span>
                </span>
              </div>
              <div className="new-version-confirm-row">
                <span className="new-version-confirm-label">{t("Tag")}</span>
                <span className="new-version-confirm-value new-version-mono">
                  {versionTag.trim()}
                </span>
              </div>
              <div className="new-version-confirm-row">
                <span className="new-version-confirm-label">{t("Commit Message")}</span>
                <span className="new-version-confirm-value">{commitMessage}</span>
              </div>
              <div className="new-version-confirm-row">
                <span className="new-version-confirm-label">{t("Files included")}</span>
                <span className="new-version-confirm-value">
                  {t("{0} file(s)", versionFileCount)}
                </span>
              </div>
              <div className="new-version-confirm-row">
                <span className="new-version-confirm-label">{t("Changelog")}</span>
                <span className="new-version-confirm-value">
                  {updatesChangelog ? t("Yes") : t("No")}
                </span>
              </div>
              {context.currentVersion && (
                <div className="new-version-confirm-row">
                  <span className="new-version-confirm-label">{t("package.json")}</span>
                  <span className="new-version-confirm-value">
                    {updatePackageJson ? t("Yes") : t("No")}
                  </span>
                </div>
              )}
            </div>

            {uncommittedCount > 0 && (
              <div className="new-version-confirm-warn" role="note">
                <WarningIcon />
                <span>
                  {t(
                    "{0} uncommitted change(s) detected. They will NOT be included in the new version commit.",
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

            <div className="new-version-prompt-actions">
              <span className="new-version-prompt-spacer" />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={creating}
                onClick={() => setConfirmOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canCreate || creating}
                onClick={() => void createNewVersion()}
              >
                {creating && <LoadingIcon className="new-version-spin" />}
                {creating ? t("Creating new version...") : t("Confirm")}
              </button>
            </div>
          </>
        );
      })()}
    </ModalOverlay>
  );

  // Generated notes cover lastTag..HEAD commits only, so generation needs
  // pending commits to work from. Without a changelog file the draft has
  // nowhere to land → hide the icon entirely (like the missing checkbox).
  // At least one commit must also be checked for the prompt.
  const selectedCommitHashes = useNewVersionStore(
    (s) => s.selectedCommitHashes,
  );
  const selectedCount = context.commits.filter((c) =>
    selectedCommitHashes.includes(c.hash),
  ).length;
  const hasSelectedCommits = selectedCount > 0;
  const canGenerate = aiConfigured && hasCommits && hasSelectedCommits;
  const showAiIcon = context.changelogFile != null;

  // ── Action rows (CommitMessageArea pattern): checkbox + AI icon row,
  // then a right-aligned .btn-row ──
  return (
    <>
      {confirmModal}
      {(context.currentVersion || showAiIcon) && (
        <div className="new-version-check-row">
          {context.currentVersion && (
            <label
              className="new-version-action-check"
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
          {showAiIcon && (
            <div className="new-version-check-row-right">
              {generating && elapsed != null && (
                <span
                  className="new-version-elapsed"
                  title={t("Generating changelog...")}
                >
                  {elapsed}
                </span>
              )}
              <AiGenerateIcon
                generating={generating}
                canGenerate={canGenerate}
                aiConfigured={aiConfigured}
                hasCommits={hasCommits}
                hasSelectedCommits={hasSelectedCommits}
                onStart={() => void generateChangelog()}
                onStop={() => void cancelGeneration()}
              />
            </div>
          )}
        </div>
      )}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canCreate}
          title={createTitle}
          onClick={() => {
            if (canCreate) setConfirmOpen(true);
          }}
        >
          {t("Create New Version")}
        </button>
      </div>
    </>
  );
}

// ── AI generate icon (CommitMessageArea pattern) ────────────────────────────

/**
 * Sparkle icon button that starts changelog generation; while generating it
 * spins (hover reveals a stop icon) — visual/interaction twin of the commit
 * message area's AI button. Sits right-aligned in the checkbox row.
 */
function AiGenerateIcon({
  generating,
  canGenerate,
  aiConfigured,
  hasCommits,
  hasSelectedCommits,
  onStart,
  onStop,
}: {
  generating: boolean;
  canGenerate: boolean;
  aiConfigured: boolean;
  hasCommits: boolean;
  hasSelectedCommits: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [hover, setHover] = useState(false);
  const clickable = generating || canGenerate;
  const baseOpacity = generating ? 1 : clickable ? 0.6 : 0.3;
  const tooltip = generating
    ? t("Stop generating")
    : !aiConfigured
      ? t("AI is not configured")
      : !hasCommits
        ? t("No new commits since last version")
        : !hasSelectedCommits
          ? t("Select at least one commit")
          : t("Generate with AI");

  return (
    <Tooltip text={tooltip}>
      <span
        onClick={() => {
          if (!clickable) return;
          generating ? onStop() : onStart();
        }}
        style={{
          cursor: clickable ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          borderRadius: 3,
          padding: 2,
          opacity: baseOpacity,
          transition: "background 0.15s, opacity 0.15s",
        }}
        onMouseEnter={(e) => {
          setHover(true);
          if (clickable) (e.currentTarget as HTMLElement).style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          setHover(false);
          if (clickable)
            (e.currentTarget as HTMLElement).style.opacity = String(baseOpacity);
        }}
        onMouseDown={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.15))";
        }}
        onMouseUp={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        {generating ? (
          hover ? (
            <StopIcon className="new-version-stop-icon" style={{ fontSize: 14 }} />
          ) : (
            <LoadingIcon className="new-version-spin" style={{ fontSize: 14 }} />
          )
        ) : (
          <SparkleIcon
            style={{
              fontSize: 14,
              color: canGenerate
                ? "var(--vscode-textLink-foreground, #3794ff)"
                : undefined,
            }}
          />
        )}
      </span>
    </Tooltip>
  );
}
