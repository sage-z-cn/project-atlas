import { t } from "../../shared/i18n";
import { useNewVersionStore } from "../../shared/store/new-version-store";
import { ModalOverlay } from "./PromptEditor";
import ArrowRightIcon from "~icons/codicon/arrow-right";
import CheckIcon from "~icons/codicon/check";
import CloseIcon from "~icons/codicon/close";
import ErrorIcon from "~icons/codicon/error";
import LoadingIcon from "~icons/codicon/loading";
import RepoPushIcon from "~icons/codicon/repo-push";

/** Success state: shown as a modal until [Done] (or close) is clicked. */
export function NewVersionResultPanel() {
  const result = useNewVersionStore((s) => s.result);
  const fromVersion = useNewVersionStore((s) => s.fromVersion);
  const pushing = useNewVersionStore((s) => s.pushing);
  const pushed = useNewVersionStore((s) => s.pushed);
  const pushError = useNewVersionStore((s) => s.pushError);
  const pushCreatedNewVersion = useNewVersionStore((s) => s.pushCreatedNewVersion);
  const finish = useNewVersionStore((s) => s.finish);
  const locateCommit = useNewVersionStore((s) => s.locateCommit);

  if (!result) return null;

  return (
    <ModalOverlay
      onClose={() => {
        // Escape / backdrop dismiss = finish (reset the panel). Guard while
        // the push is in flight so it can't be abandoned mid-way.
        if (!pushing) void finish();
      }}
      ariaLabel={t("New version created")}
    >
      <div className="new-version-modal-head">
        <span className="new-version-modal-title new-version-result-head">
          <CheckIcon />
          {t("New version created")}
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
      <div className="new-version-confirm-row">
        <span className="new-version-confirm-label">{t("Version")}</span>
        <span className="new-version-confirm-value new-version-mono">
          {fromVersion ?? "—"}
          <ArrowRightIcon className="new-version-version-arrow" />
          <span className="new-version-version-new">{result.version}</span>
        </span>
      </div>
      <div className="new-version-confirm-row">
        <span className="new-version-confirm-label">{t("Tag")}</span>
        <span className="new-version-confirm-value new-version-mono">{result.tagName}</span>
      </div>
      <div className="new-version-confirm-row">
        <span className="new-version-confirm-label">{t("Commit")}</span>
        <span className="new-version-confirm-value">
          <button
            type="button"
            className="new-version-link-btn new-version-mono"
            title={t("Click to locate this commit in the Git Log")}
            onClick={() => locateCommit(result.commitHash)}
          >
            {result.commitHash.slice(0, 7)}
          </button>
        </span>
      </div>
      <div className="new-version-confirm-row">
        <span className="new-version-confirm-label">{t("Files")}</span>
        <span className="new-version-confirm-value">
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
            onClick={() => useNewVersionStore.setState({ pushError: null })}
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
          onClick={() => void pushCreatedNewVersion()}
        >
          {pushing ? (
            <LoadingIcon className="new-version-spin" />
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
