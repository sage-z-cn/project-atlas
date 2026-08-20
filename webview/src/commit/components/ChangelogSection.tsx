import { useEffect, useRef, useState } from "react";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useAutoResizeTextarea } from "../../shared/hooks/useAutoResizeTextarea";
import { useCommitStore } from "../../shared/store/commit-store";
import { useNewVersionStore } from "../../shared/store/new-version-store";
import type { NewVersionContext } from "../../shared/store/new-version-store";
import { ChangelogInitForm } from "./ChangelogInitForm";
import { PromptEditor } from "./PromptEditor";
import CloseIcon from "~icons/codicon/close";
import ErrorIcon from "~icons/codicon/error";

/**
 * Bottom-bar changelog area (mirrors CommitMessageArea's compactness):
 * header row (file + language + prompt gear), AI banners, and the editable
 * draft. The AI generate icon and its elapsed timer live in the checkbox row
 * below the textarea (see NewVersionTab's CreateSection) — same position as
 * the commit panel's AI button. No changelog file yet → compact init form.
 */
export function ChangelogSection({ context }: { context: NewVersionContext }) {
  const genError = useNewVersionStore((s) => s.genError);
  const setGenError = useNewVersionStore((s) => s.setGenError);
  const changelogDraft = useNewVersionStore((s) => s.changelogDraft);
  const setChangelogDraft = useNewVersionStore((s) => s.setChangelogDraft);
  const langOverride = useNewVersionStore((s) => s.changelogLanguageOverride);
  const setLangOverride = useNewVersionStore((s) => s.setChangelogLanguageOverride);
  const aiConfigured = useCommitStore((s) => s.aiConfigured);
  // 动态高度：JS 量 scrollHeight 设定 height，CSS min/max-height 负责上下限
  // （最少 5 行、最多 20 行，超限后内部滚动）。
  const taRef = useAutoResizeTextarea(changelogDraft);

  if (!context.changelogFile) {
    return <ChangelogInitForm defaultLanguage={context.changelogLanguage} />;
  }

  const effectiveLang = langOverride ?? context.changelogLanguage;

  return (
    <>
      <div className="new-version-changelog-head">
        <span className="new-version-changelog-file new-version-mono" title={context.changelogFile}>
          {context.changelogFile}
        </span>
        <LanguageChip
          value={effectiveLang}
          onSelect={(lang) => setLangOverride(lang)}
        />
        <div className="new-version-changelog-actions">
          <PromptEditor />
        </div>
      </div>

      {!aiConfigured && (
        <div className="new-version-ai-banner" role="alert">
          <ErrorIcon />
          <span className="new-version-ai-banner-text">
            {t("AI is not configured. Set it up to generate changelog drafts.")}
          </span>
          <span className="new-version-ai-banner-actions">
            <button
              type="button"
              className="new-version-link-btn"
              onClick={() => void bridge.request("openAiSettings").catch(() => {})}
            >
              {t("Open Settings")}
            </button>
            <button
              type="button"
              className="new-version-link-btn"
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
        ref={taRef}
        className="new-version-changelog-textarea"
        value={changelogDraft}
        placeholder={t("Changelog draft for the new version")}
        onChange={(e) => setChangelogDraft(e.target.value)}
        spellCheck={false}
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
    <span className="new-version-lang-wrap" ref={wrapRef}>
      <button
        type="button"
        className="new-version-lang-chip interactive"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {value}
      </button>
      {open && (
        <span className="new-version-lang-menu" role="menu">
          {(["zh", "en"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              role="menuitemradio"
              aria-checked={value === lang}
              className={`new-version-lang-option${value === lang ? " active" : ""}`}
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
