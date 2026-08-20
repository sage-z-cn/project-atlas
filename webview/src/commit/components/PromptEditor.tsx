import { useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { useNewVersionStore } from "../../shared/store/new-version-store";
import { ModalOverlay } from "./Modal";
import CloseIcon from "~icons/codicon/close";
import ErrorIcon from "~icons/codicon/error";
import LoadingIcon from "~icons/codicon/loading";
import SettingsGearIcon from "~icons/codicon/settings-gear";

// ── Prompt editor ────────────────────────────────────────────────────────────

/**
 * Gear icon button in the bottom-bar changelog header. Opens a centered
 * modal for editing the AI changelog prompt. The "customized" dot mirrors
 * promptCustomized from the new version context.
 */
export function PromptEditor() {
  const context = useNewVersionStore((s) => s.context);
  const promptOpen = useNewVersionStore((s) => s.promptOpen);
  const setPromptOpen = useNewVersionStore((s) => s.setPromptOpen);

  if (!context) return null;

  const label = context.promptCustomized
    ? t("Edit Prompt (customized)")
    : t("Edit Prompt");

  return (
    <>
      <button
        type="button"
        className={`new-version-prompt-trigger${
          context.promptCustomized ? " customized" : ""
        }`}
        title={label}
        aria-label={label}
        onClick={() => setPromptOpen(true)}
      >
        <SettingsGearIcon />
        {context.promptCustomized && (
          <span className="new-version-prompt-dot" aria-hidden="true" />
        )}
      </button>
      {promptOpen && <PromptModal onClose={() => setPromptOpen(false)} />}
    </>
  );
}

function PromptModal({ onClose }: { onClose: () => void }) {
  const promptDraft = useNewVersionStore((s) => s.promptDraft);
  const promptError = useNewVersionStore((s) => s.promptError);
  const setPromptDraft = useNewVersionStore((s) => s.setPromptDraft);
  const setPromptError = useNewVersionStore((s) => s.setPromptError);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await useNewVersionStore.getState().savePrompt();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await useNewVersionStore.getState().restorePrompt();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay
      onClose={onClose}
      ariaLabel={t("New Version Prompt")}
      initialFocusRef={textareaRef}
    >
      <div className="new-version-modal-head">
        <span className="new-version-modal-title">{t("New Version Prompt")}</span>
        <button
          type="button"
          className="commit-error-close"
          aria-label={t("Cancel")}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="new-version-prompt-help">
        {t("The {{language}} placeholder is replaced with the changelog language.")}
        {" "}
        {t("Edits are kept as a draft until saved.")}
      </div>

      <textarea
        ref={textareaRef}
        className="new-version-prompt-textarea new-version-modal-textarea"
        value={promptDraft}
        onChange={(e) => setPromptDraft(e.target.value)}
        spellCheck={false}
        rows={10}
      />

      {promptError && (
        <div className="commit-error-banner" role="alert">
          <ErrorIcon className="commit-error-icon" />
          <span className="commit-error-message">{promptError}</span>
          <button
            type="button"
            className="commit-error-close"
            aria-label={t("Dismiss")}
            onClick={() => setPromptError(null)}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <div className="new-version-prompt-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving}
          onClick={() => void handleRestore()}
        >
          {t("Restore Default")}
        </button>
        <span className="new-version-prompt-spacer" />
        {savedFlash && (
          <span className="new-version-saved-flash">{t("Saved")}</span>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving}
          onClick={onClose}
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving && <LoadingIcon className="new-version-spin" />}
          {t("Save")}
        </button>
      </div>
    </ModalOverlay>
  );
}
