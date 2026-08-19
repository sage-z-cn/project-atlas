import { useEffect, useRef, useState } from "react";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import { useReleaseStore } from "../../shared/store/release-store";
import type { ReleaseContext } from "../../shared/store/release-store";
import { ChangelogInitForm } from "./ChangelogInitForm";
import { PromptEditor } from "./PromptEditor";
import CloseIcon from "~icons/codicon/close";
import ErrorIcon from "~icons/codicon/error";

/**
 * Bottom-bar changelog area (mirrors CommitMessageArea's compactness):
 * header row (file + language + prompt gear), AI banners, and the editable
 * draft. The Generate button and its elapsed timer live in the action row
 * next to Create Release (see ReleaseTab's CreateSection).
 * No changelog file yet → compact init form instead.
 */
export function ChangelogSection({ context }: { context: ReleaseContext }) {
  const genError = useReleaseStore((s) => s.genError);
  const setGenError = useReleaseStore((s) => s.setGenError);
  const changelogDraft = useReleaseStore((s) => s.changelogDraft);
  const setChangelogDraft = useReleaseStore((s) => s.setChangelogDraft);
  const langOverride = useReleaseStore((s) => s.changelogLanguageOverride);
  const setLangOverride = useReleaseStore((s) => s.setChangelogLanguageOverride);
  const aiConfigured = useCommitStore((s) => s.aiConfigured);

  if (!context.changelogFile) {
    return <ChangelogInitForm defaultLanguage={context.changelogLanguage} />;
  }

  const effectiveLang = langOverride ?? context.changelogLanguage;

  return (
    <>
      <div className="release-changelog-head">
        <span className="release-changelog-file release-mono" title={context.changelogFile}>
          {context.changelogFile}
        </span>
        <LanguageChip
          value={effectiveLang}
          onSelect={(lang) => setLangOverride(lang)}
        />
        <div className="release-changelog-actions">
          <PromptEditor />
        </div>
      </div>

      {!aiConfigured && (
        <div className="release-ai-banner" role="alert">
          <ErrorIcon />
          <span className="release-ai-banner-text">
            {t("AI is not configured. Set it up to generate changelog drafts.")}
          </span>
          <span className="release-ai-banner-actions">
            <button
              type="button"
              className="release-link-btn"
              onClick={() => void bridge.request("openAiSettings").catch(() => {})}
            >
              {t("Open Settings")}
            </button>
            <button
              type="button"
              className="release-link-btn"
              onClick={() =>
                void bridge
                  .request("setAiApiKey", {}, { timeout: 120_000 })
                  .catch(() => {})
              }
            >
              {t("Set API Key")}
            </button>
          </span>
        </div>
      )}

      {genError && (
        <div className="commit-error-banner" role="alert">
          <ErrorIcon className="commit-error-icon" />
          <span className="commit-error-message">{genError}</span>
          <button
            type="button"
            className="commit-error-close"
            aria-label={t("Dismiss")}
            onClick={() => setGenError(null)}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <textarea
        className="release-changelog-textarea"
        value={changelogDraft}
        placeholder={t("Changelog draft for this release")}
        onChange={(e) => setChangelogDraft(e.target.value)}
        spellCheck={false}
        rows={20}
      />
    </>
  );
}

// ── Language chip + popover ──────────────────────────────────────────────────

/**
 * Interactive language chip: click → small popover with 中文 / English.
 * The highlighted value is the override when set, else the detected one.
 */
function LanguageChip({
  value,
  onSelect,
}: {
  value: "zh" | "en";
  onSelect: (lang: "zh" | "en") => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Outside-click / Escape close (context-menu pattern).
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const label = t("Changelog language");

  return (
    <span className="release-lang-wrap" ref={wrapRef}>
      <button
        type="button"
        className="release-lang-chip interactive"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {value}
      </button>
      {open && (
        <span className="release-lang-menu" role="menu">
          {(["zh", "en"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              role="menuitemradio"
              aria-checked={value === lang}
              className={`release-lang-option${value === lang ? " active" : ""}`}
              onClick={() => {
                onSelect(lang);
                setOpen(false);
              }}
            >
              {lang === "zh" ? t("Chinese") : t("English")}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
