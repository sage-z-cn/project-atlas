import { useEffect, useRef, useState } from "react";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useAutoResizeTextarea } from "../../shared/hooks/useAutoResizeTextarea";
import { useCommitStore } from "../../shared/store/commit-store";
import { useNewVersionStore } from "../../shared/store/new-version-store";
import type { NewVersionContext, NewVersionLanguageValue } from "../../shared/store/new-version-store";
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
  const setNewVersionLanguage = useNewVersionStore((s) => s.setNewVersionLanguage);
  const aiConfigured = useCommitStore((s) => s.aiConfigured);
  // 动态高度：JS 量 scrollHeight 设定 height，CSS min/max-height 负责上下限
  // （最少 5 行、最多 20 行，超限后内部滚动）。
  const taRef = useAutoResizeTextarea(changelogDraft);

  if (!context.changelogFile) {
    return <ChangelogInitForm defaultLanguage={context.changelogLanguage} />;
  }

  return (
    <>
      <div className="new-version-changelog-head">
        <span className="new-version-changelog-file new-version-mono" title={context.changelogFile}>
          {context.changelogFile}
        </span>
        <LanguageChip
          value={context.language.effective}
          hasOverride={context.language.workspaceOverride != null}
          globalDefault={context.language.globalDefault}
          onSelect={(lang) => void setNewVersionLanguage(lang)}
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
        <div className="commit-message-banner" role="alert">
          <ErrorIcon className="commit-message-banner-icon" />
          <span className="commit-message-banner-text">{genError}</span>
          <button
            type="button"
            className="commit-message-banner-close"
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
 * Short label shown on the chip (copied from CommitMessageArea's aiLangShort,
 * renamed without the ai prefix).
 */
function langShort(lang: NewVersionLanguageValue): string {
  if (lang === "zh") return "zh";
  if (lang === "en") return "en";
  if (lang === "follow-locale") return "locale";
  return "auto";
}

/** Full menu label (copied from CommitMessageArea's aiLangLabel). */
function langLabel(lang: NewVersionLanguageValue): string {
  if (lang === "zh") return t("Chinese");
  if (lang === "en") return t("English");
  if (lang === "follow-locale") return t("Follow VS Code");
  return t("Auto detect");
}

/**
 * Changelog language chip (same interaction as the commit-message AI language
 * chip). Writes a Workspace override; "use global" clears it so the User
 * setting applies again.
 */
function LanguageChip({
  value,
  hasOverride,
  globalDefault,
  onSelect,
}: {
  value: NewVersionLanguageValue;
  hasOverride: boolean;
  globalDefault: NewVersionLanguageValue;
  onSelect: (lang: NewVersionLanguageValue | null) => void;
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
  const title = hasOverride
    ? `${label}: ${langLabel(value)} (${t("Workspace")})`
    : `${label}: ${langLabel(value)} (${t("Global default")})`;

  const options: NewVersionLanguageValue[] = ["auto", "en", "zh", "follow-locale"];

  return (
    <span className="new-version-lang-wrap" ref={wrapRef}>
      <button
        type="button"
        className="new-version-lang-chip new-version-lang-chip-ghost interactive"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {langShort(value)}
      </button>
      {open && (
        <span className="new-version-lang-menu" role="menu">
          {options.map((lang) => (
            <button
              key={lang}
              type="button"
              role="menuitemradio"
              aria-checked={value === lang && (hasOverride || lang === globalDefault)}
              className={`new-version-lang-option${value === lang && hasOverride ? " active" : ""}`}
              onClick={() => {
                onSelect(lang);
                setOpen(false);
              }}
            >
              {langLabel(lang)}
            </button>
          ))}
          {hasOverride && (
            <>
              <div className="commit-dropdown-separator" />
              <button
                type="button"
                role="menuitem"
                className="new-version-lang-option"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
              >
                {t("Use global default ({0})", langLabel(globalDefault))}
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}
