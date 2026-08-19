import { t } from "../../shared/i18n";
import { useReleaseStore } from "../../shared/store/release-store";
import { ModalOverlay } from "./PromptEditor";
import ArrowRightIcon from "~icons/codicon/arrow-right";
import CheckIcon from "~icons/codicon/check";
import CloseIcon from "~icons/codicon/close";
import ErrorIcon from "~icons/codicon/error";
import LoadingIcon from "~icons/codicon/loading";
import RepoPushIcon from "~icons/codicon/repo-push";

/** Success state: shown as a modal until [Done] (or close) is clicked. */
export function ReleaseResultPanel() {
  const result = useReleaseStore((s) => s.result);
  const fromVersion = useReleaseStore((s) => s.fromVersion);
  const pushing = useReleaseStore((s) => s.pushing);
  const pushed = useReleaseStore((s) => s.pushed);
  const pushError = useReleaseStore((s) => s.pushError);
  const pushCreatedRelease = useReleaseStore((s) => s.pushCreatedRelease);
  const finish = useReleaseStore((s) => s.finish);
  const locateCommit = useReleaseStore((s) => s.locateCommit);

  if (!result) return null;

  return (
    <ModalOverlay
      onClose={() => {
        // Escape / backdrop dismiss = finish (reset the panel). Guard while
        // the push is in flight so it can't be abandoned mid-way.
        if (!pushing) void finish();
      }}
      ariaLabel={t("Release created")}
    >
      <div className="release-modal-head">
        <span className="release-modal-title release-result-head">
          <CheckIcon />
          {t("Release created")}
        </span>
        <button
          type="button"
          className="commit-error-close"
          aria-label={t("Close")}
          onClick={() => {
            if (!pushing) void finish();
          }}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="release-confirm-row">
        <span className="release-confirm-label">{t("Version")}</span>
        <span className="release-confirm-value release-mono">
          {fromVersion ?? "—"}
          <ArrowRightIcon className="release-version-arrow" />
          <span className="release-version-new">{result.version}</span>
        </span>
      </div>
      <div className="release-confirm-row">
        <span className="release-confirm-label">{t("Tag")}</span>
        <span className="release-confirm-value release-mono">{result.tagName}</span>
      </div>
      <div className="release-confirm-row">
        <span className="release-confirm-label">{t("Commit")}</span>
        <span className="release-confirm-value">
          <button
            type="button"
            className="release-link-btn release-mono"
            title={t("Click to locate this commit in the Git Log")}
            onClick={() => locateCommit(result.commitHash)}
          >
            {result.commitHash.slice(0, 7)}
          </button>
        </span>
      </div>
      <div className="release-confirm-row">
        <span className="release-confirm-label">{t("Files")}</span>
        <span className="release-confirm-value">
          {t("{0} file(s) updated", result.updatedFiles.length)}
        </span>
      </div>

      {pushError && (
        <div className="commit-error-banner" role="alert">
          <ErrorIcon className="commit-error-icon" />
          <span className="commit-error-message">{pushError}</span>
          <button
            type="button"
            className="commit-error-close"
            aria-label={t("Dismiss")}
            onClick={() => useReleaseStore.setState({ pushError: null })}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <div className="commit-buttons">
        <button
          type="button"
          className="commit-btn commit-btn-secondary"
          disabled={pushing || pushed}
          onClick={() => void pushCreatedRelease()}
        >
          {pushing ? (
            <LoadingIcon className="release-spin" />
          ) : pushed ? (
            <CheckIcon />
          ) : (
            <RepoPushIcon />
          )}
          {pushed ? t("Pushed") : t("Push Branch and Tag")}
        </button>
        <button
          type="button"
          className="commit-btn commit-btn-primary"
          disabled={pushing}
          onClick={() => void finish()}
        >
          {t("Done")}
        </button>
      </div>
    </ModalOverlay>
  );
}
