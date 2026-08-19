import { useState } from "react";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useReleaseStore } from "../../shared/store/release-store";
import ErrorIcon from "~icons/codicon/error";
import LoadingIcon from "~icons/codicon/loading";
import NewFileIcon from "~icons/codicon/new-file";

/**
 * Rendered when getReleaseContext reports no changelog file. On success the
 * host drops the new file into the working tree (untracked) and the section
 * flips to its normal form via applyChangelogFile.
 */
export function ChangelogInitForm({ defaultLanguage }: { defaultLanguage: "zh" | "en" }) {
  const [filename, setFilename] = useState("CHANGELOG.md");
  const [language, setLanguage] = useState<"zh" | "en">(defaultLanguage);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = filename.trim();
  const nameOk = trimmed.length > 0 && trimmed.toLowerCase().includes("changelog");

  const handleInit = async () => {
    if (!nameOk || initializing) return;
    setInitializing(true);
    setError(null);
    try {
      const result = (await bridge.request(
        "initChangelog",
        { filename: trimmed, language },
        { timeout: 15_000 },
      )) as { changelogFile?: string };
      if (result?.changelogFile) {
        useReleaseStore
          .getState()
          .applyChangelogFile(result.changelogFile, language);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="release-init-box">
      <div className="release-init-hint">
        {t("No changelog file found. Initialize one to record release notes.")}
      </div>

      <div className="release-init-row">
        <div className="release-field">
          <label className="release-field-label">{t("File name")}</label>
          <input
            className="release-input release-mono"
            value={filename}
            placeholder="CHANGELOG.md"
            spellCheck={false}
            onChange={(e) => setFilename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleInit();
            }}
          />
        </div>
        <div className="release-field release-init-lang">
          <label className="release-field-label">{t("Language")}</label>
          <div className="release-bump-group" role="radiogroup" aria-label={t("Language")}>
            <button
              type="button"
              role="radio"
              aria-checked={language === "zh"}
              className={`release-bump-btn${language === "zh" ? " active" : ""}`}
              onClick={() => setLanguage("zh")}
            >
              {t("Chinese")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={language === "en"}
              className={`release-bump-btn${language === "en" ? " active" : ""}`}
              onClick={() => setLanguage("en")}
            >
              {t("English")}
            </button>
          </div>
        </div>
      </div>

      {!nameOk && trimmed.length > 0 && (
        <div className="release-hint-error">
          <ErrorIcon />
          {t('Filename must contain "changelog"')}
        </div>
      )}
      {error && (
        <div className="commit-error-banner" role="alert">
          <ErrorIcon className="commit-error-icon" />
          <span className="commit-error-message">{error}</span>
        </div>
      )}

      <div>
        <button
          type="button"
          className="commit-btn commit-btn-primary"
          disabled={!nameOk || initializing}
          onClick={() => void handleInit()}
        >
          {initializing ? <LoadingIcon className="release-spin" /> : <NewFileIcon />}
          {t("Initialize")}
        </button>
      </div>
    </div>
  );
}
