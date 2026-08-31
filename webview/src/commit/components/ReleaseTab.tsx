import { useEffect, useState } from "react";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useReleaseStore } from "../../shared/store/release-store";
import {
  formatAttachmentSize,
  GITEE_ATTACHMENT_LIMIT,
  isAttachmentOverLimit,
  releaseCanPublish,
  releaseHasGiteeSelected,
  releaseOverLimitAttachments,
  targetKey,
} from "../../shared/store/release-store";
import type {
  ReleasePublishResult,
  ReleaseTarget,
} from "../../shared/store/release-store";
import { ModalOverlay } from "./Modal";
import CheckIcon from "~icons/codicon/check";
import CloseIcon from "~icons/codicon/close";
import CopyIcon from "~icons/codicon/copy";
import ErrorIcon from "~icons/codicon/error";
import LinkExternalIcon from "~icons/codicon/link-external";
import LoadingIcon from "~icons/codicon/loading";
import PlusIcon from "~icons/codicon/add";
import RefreshIcon from "~icons/codicon/refresh";
import TrashIcon from "~icons/codicon/trash";
import WarningIcon from "~icons/codicon/warning";

/**
 * Remote release publishing form, laid out after GitHub's release page
 * (`github.com/{owner}/{repo}/releases/new`): target platforms → target
 * branch → tag (choose/new) → title → notes → attachments → flags →
 * publish. Results (one row per platform) show in a centered modal (see
 * ReleaseResultModal) once publishing finishes; closing it resets the
 * form (already refreshed by publish) back to the idle action row.
 */
export function ReleaseTab() {
  const targets = useReleaseStore((s) => s.targets);
  const loading = useReleaseStore((s) => s.loading);
  const loadError = useReleaseStore((s) => s.loadError);
  const publishError = useReleaseStore((s) => s.publishError);

  // Tab activation = component mount (App renders tabs conditionally):
  // load targets, then consume any cross-tab prefill left by the
  // new-version result panel.
  useEffect(() => {
    void useReleaseStore.getState().fetchTargets();
    useReleaseStore.getState().consumePrefill();
  }, []);

  // Loading / error shell (targets are the page's backbone).
  if (loading && targets.length === 0 && !loadError) {
    return (
      <div className="release-tab">
        <div className="release-scroll-center">
          <LoadingIcon className="new-version-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="release-tab">
      <div className="release-scroll">
        {loadError ? (
          <div className="commit-error-banner" role="alert">
            <ErrorIcon className="commit-error-icon" />
            <span className="commit-error-message">
              {t("Failed to load release targets")}
              {loadError ? `: ${loadError}` : ""}
            </span>
            <button
              type="button"
              className="commit-error-close"
              aria-label={t("Retry")}
              title={t("Retry")}
              onClick={() =>
                void useReleaseStore.getState().fetchTargets()
              }
            >
              <RefreshIcon />
            </button>
          </div>
        ) : (
          <TargetsSection />
        )}
        <BranchAndTagSection />
        <TitleAndNotesSection />
        <AttachmentsSection />
        <FlagsSection />
        {publishError && (
          <div className="commit-error-banner" role="alert">
            <ErrorIcon className="commit-error-icon" />
            <span className="commit-error-message">{publishError}</span>
          </div>
        )}
        <PublishRow />
      </div>
      <ReleaseResultModal />
    </div>
  );
}

// ─── Target platforms ─────────────────────────────────────────────────────────

function TargetsSection() {
  const targets = useReleaseStore((s) => s.targets);
  const selected = useReleaseStore((s) => s.selected);

  return (
    <section className="new-version-section">
      <div className="new-version-section-title">{t("Targets")}</div>
      {targets.length === 0 ? (
        <div className="new-version-hint-warn">
          <WarningIcon />
          <span>{t("No supported remote release targets found")}</span>
        </div>
      ) : (
        targets.map((target) => (
          <TargetRow key={targetKey(target.platform, target.remoteName)} target={target} />
        ))
      )}
      {selected.length === 0 && targets.length > 0 && (
        <div className="new-version-hint-warn">
          <WarningIcon />
          <span>{t("Select at least one target platform")}</span>
        </div>
      )}
    </section>
  );
}

function TargetRow({ target }: { target: ReleaseTarget }) {
  const checked = useReleaseStore((s) =>
    s.selected.includes(targetKey(target.platform, target.remoteName)),
  );
  const warn = !target.configured || !target.authOk;
  // Gitee without a stored token → inline "Set Gitee Token" button (host
  // shows the token input box). GitHub auth is a terminal-side
  // `gh auth login` — nothing to click, keep the plain-text hint.
  const needsGiteeToken = target.platform === "gitee" && !target.configured;
  const hint =
    target.authHint ??
    (target.platform === "gitee" && !target.authOk
      ? t("Set the Gitee access token via the command: Git Atlas: Set Gitee Token")
      : t("Authentication required"));

  return (
    <div className={`release-target-row${warn ? " warn" : ""}`}>
      <label className="new-version-action-check release-target-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={!target.configured}
          onChange={() =>
            useReleaseStore
              .getState()
              .toggleTarget(target.platform, target.remoteName)
          }
        />
        <span className="release-platform-badge">{target.platform}</span>
        <span className="release-target-repo new-version-mono">
          {target.owner}/{target.repo} ({target.remoteName})
        </span>
      </label>
      {warn && (
        <div className="release-target-hint new-version-hint-warn">
          <WarningIcon />
          {needsGiteeToken ? (
            <button
              type="button"
              className="release-target-action"
              onClick={() =>
                void useReleaseStore.getState().promptGiteeToken()
              }
            >
              {t("Set Gitee Token")}
            </button>
          ) : (
            <span>{hint}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Target branch + tag (choose a tag / new tag) ────────────────────────────

function BranchAndTagSection() {
  const branches = useReleaseStore((s) => s.branches);
  const tags = useReleaseStore((s) => s.tags);
  const targetBranch = useReleaseStore((s) => s.targetBranch);
  const setTargetBranch = useReleaseStore((s) => s.setTargetBranch);
  const isNewTag = useReleaseStore((s) => s.isNewTag);
  const tagName = useReleaseStore((s) => s.tagName);
  const selectTag = useReleaseStore((s) => s.selectTag);
  const setTagName = useReleaseStore((s) => s.setTagName);
  const setTagMode = useReleaseStore((s) => s.setTagMode);

  return (
    <section className="new-version-section">
      <div className="new-version-section-title">{t("Target branch")}</div>
      <select
        className="new-version-input release-select"
        value={targetBranch}
        onChange={(e) => setTargetBranch(e.target.value)}
        aria-label={t("Target branch")}
      >
        {branches.length === 0 && <option value="">{t("No branches found")}</option>}
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      <div className="new-version-section-title">{t("Tag")}</div>
      <div
        className="release-mode-group"
        role="radiogroup"
        aria-label={t("Tag")}
      >
        <button
          type="button"
          role="radio"
          aria-checked={!isNewTag}
          className={`release-mode-btn${!isNewTag ? " active" : ""}`}
          onClick={() => setTagMode(false)}
        >
          {t("Choose a tag")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isNewTag}
          className={`release-mode-btn${isNewTag ? " active" : ""}`}
          onClick={() => setTagMode(true)}
        >
          {t("New tag")}
        </button>
      </div>
      {!isNewTag ? (
        tags.length === 0 ? (
          <div className="new-version-hint-warn">
            <WarningIcon />
            <span>{t("No tags found")}</span>
          </div>
        ) : (
          <select
            className="new-version-input release-select new-version-mono"
            value={tagName}
            onChange={(e) => selectTag(e.target.value)}
            aria-label={t("Choose a tag")}
          >
            <option value="">{t("Choose a tag")}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        )
      ) : (
        <input
          className="new-version-input new-version-mono"
          value={tagName}
          onChange={(e) => setTagName(e.target.value)}
          placeholder="v1.0.0"
          aria-label={t("New tag")}
          title={t("New tag")}
          spellCheck={false}
        />
      )}
    </section>
  );
}

// ─── Title + notes ────────────────────────────────────────────────────────────

function TitleAndNotesSection() {
  const title = useReleaseStore((s) => s.title);
  const setTitle = useReleaseStore((s) => s.setTitle);
  const notes = useReleaseStore((s) => s.notes);
  const setNotes = useReleaseStore((s) => s.setNotes);

  return (
    <section className="new-version-section">
      <div className="new-version-section-title">{t("Release title")}</div>
      <input
        className="new-version-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="v1.0.0"
        aria-label={t("Release title")}
        spellCheck={false}
      />

      <div className="new-version-section-title">{t("Notes")}</div>
      <textarea
        className="release-notes-textarea"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t("Describe this release")}
        aria-label={t("Notes")}
        spellCheck={false}
        rows={8}
      />
    </section>
  );
}

// ─── Attachments ──────────────────────────────────────────────────────────────

function AttachmentsSection() {
  const attachments = useReleaseStore((s) => s.attachments);
  const hasGiteeSelected = useReleaseStore(releaseHasGiteeSelected);
  const pickAttachments = useReleaseStore((s) => s.pickAttachments);
  const removeAttachment = useReleaseStore((s) => s.removeAttachment);
  const clearAttachments = useReleaseStore((s) => s.clearAttachments);

  const overLimit = releaseOverLimitAttachments(attachments);

  return (
    <section className="new-version-section">
      <div className="new-version-section-title">{t("Attachments")}</div>
      <div className="release-attachment-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void pickAttachments()}
        >
          <PlusIcon />
          {t("Select attachments")}
        </button>
        {attachments.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={clearAttachments}
          >
            <TrashIcon />
            {t("Clear all")}
          </button>
        )}
      </div>
      {attachments.map((a) => {
        const over = isAttachmentOverLimit(a);
        const name = a.path.replace(/\\/g, "/").split("/").pop() ?? a.path;
        return (
          <div key={a.path} className="release-attachment-row">
            <span className="release-attachment-name" title={a.path}>
              {name}
            </span>
            <span
              className={`release-attachment-size${over ? " over" : ""}`}
            >
              {formatAttachmentSize(a.size)}
            </span>
            {over && (
              <span className="release-attachment-over">
                {t("Exceeds the Gitee attachment limit ({0})", formatAttachmentSize(GITEE_ATTACHMENT_LIMIT))}
              </span>
            )}
            <button
              type="button"
              className="release-attachment-remove"
              aria-label={t("Remove")}
              title={t("Remove")}
              onClick={() => removeAttachment(a.path)}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
      {overLimit.length > 0 && hasGiteeSelected && (
        <div className="new-version-hint-error">
          <ErrorIcon />
          <span>
            {t(
              "Remove attachments exceeding {0} before publishing to Gitee",
              formatAttachmentSize(GITEE_ATTACHMENT_LIMIT),
            )}
          </span>
        </div>
      )}
    </section>
  );
}

// ─── Prerelease / draft flags ─────────────────────────────────────────────────

function FlagsSection() {
  const prerelease = useReleaseStore((s) => s.prerelease);
  const setPrerelease = useReleaseStore((s) => s.setPrerelease);
  const draft = useReleaseStore((s) => s.draft);
  const setDraft = useReleaseStore((s) => s.setDraft);

  return (
    <div className="new-version-check-row">
      <label className="new-version-action-check">
        <input
          type="checkbox"
          checked={prerelease}
          onChange={(e) => setPrerelease(e.target.checked)}
        />
        {t("Set as prerelease")}
      </label>
      <label className="new-version-action-check">
        <input
          type="checkbox"
          checked={draft}
          onChange={(e) => setDraft(e.target.checked)}
        />
        {t("Set as draft")}
        <span className="release-hint-inline">{t("(GitHub only)")}</span>
      </label>
    </div>
  );
}

// ─── Result modal + publish action row ────────────────────────────────────────

/**
 * Publish-finished modal (rendered while publishState === "done"): one row
 * per platform — success/failure icon, URL (open / copy) or error summary.
 * Escape / backdrop / Close all dismiss; closing returns the action row to
 * idle (the form itself was already reset by publish's resetForm).
 */
function ReleaseResultModal() {
  const publishState = useReleaseStore((s) => s.publishState);
  const results = useReleaseStore((s) => s.results);
  const closeResults = useReleaseStore((s) => s.closeResults);

  if (publishState !== "done" || results.length === 0) return null;

  const allOk = results.every((r) => r.success);
  const title = allOk ? t("Release Published") : t("Published with Errors");

  return (
    <ModalOverlay onClose={closeResults} ariaLabel={title}>
      <div className="new-version-modal-head">
        <span
          className={`new-version-modal-title release-result-head${
            allOk ? " ok" : " fail"
          }`}
        >
          {allOk ? <CheckIcon /> : <ErrorIcon />}
          {title}
        </span>
        <button
          type="button"
          className="commit-error-close"
          aria-label={t("Close")}
          title={t("Close")}
          onClick={closeResults}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="release-result-rows">
        {results.map((r) => (
          <ResultRow key={`${r.platform}:${r.remoteName}`} result={r} />
        ))}
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={closeResults}
        >
          {t("Close")}
        </button>
      </div>
    </ModalOverlay>
  );
}

function ResultRow({ result }: { result: ReleasePublishResult }) {
  const url = result.success ? result.url : undefined;
  const openUrl = () => {
    if (url) void bridge.request("openExternalUrl", { url });
  };

  return (
    <div className={`release-result-row${result.success ? " ok" : " fail"}`}>
      <span className="release-platform-badge">{result.platform}</span>
      {result.success ? <CheckIcon /> : <ErrorIcon />}
      {url ? (
        <>
          <button
            type="button"
            className="release-result-url new-version-mono"
            title={t("Open in browser")}
            onClick={openUrl}
          >
            {url}
          </button>
          <button
            type="button"
            className="release-result-open"
            aria-label={t("Open in browser")}
            title={t("Open in browser")}
            onClick={openUrl}
          >
            <LinkExternalIcon />
          </button>
          <CopyUrlButton url={url} />
        </>
      ) : result.success ? (
        <span className="release-result-text">{t("Published")}</span>
      ) : (
        <span className="release-result-error" title={result.error}>
          {result.error}
        </span>
      )}
    </div>
  );
}

/** URL copy button — the URL itself opens externally via openExternalUrl. */
function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };

  return (
    <button
      type="button"
      className="release-copy-btn"
      aria-label={t("Copy")}
      title={t("Copy")}
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function PublishRow() {
  const selected = useReleaseStore((s) => s.selected);
  const publishState = useReleaseStore((s) => s.publishState);
  const canPublish = useReleaseStore(releaseCanPublish);
  const publish = useReleaseStore((s) => s.publish);
  const attachments = useReleaseStore((s) => s.attachments);
  const hasGiteeSelected = useReleaseStore(releaseHasGiteeSelected);

  // The only hard-block reason surfaced as a tooltip: oversized attachments
  // with Gitee checked (the store gate blocks everything else generically).
  const overLimit = releaseOverLimitAttachments(attachments);
  const blockedBySize = hasGiteeSelected && overLimit.length > 0;
  const title = blockedBySize
    ? t(
        "Remove attachments exceeding {0} before publishing to Gitee",
        formatAttachmentSize(GITEE_ATTACHMENT_LIMIT),
      )
    : undefined;

  const publishing = publishState === "publishing";
  return (
    <div className="btn-row">
      <button
        type="button"
        className="btn btn-primary"
        disabled={!canPublish || publishing}
        title={title}
        onClick={() => void publish()}
      >
        {publishing ? (
          <LoadingIcon className="new-version-spin" />
        ) : (
          <LinkExternalIcon />
        )}
        {publishing
          ? t("Publishing...")
          : selected.length > 1
            ? t("Publish to all platforms")
            : t("Publish")}
      </button>
    </div>
  );
}
