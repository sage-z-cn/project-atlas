import { useState } from "react";
import { t } from "../../shared/i18n";
import { useNewVersionStore } from "../../shared/store/new-version-store";
import type { NewVersionCommit } from "../../shared/store/new-version-store";
import ChevronIcon from "~icons/codicon/chevron-right";

export function CommitRangeList({ commits }: { commits: NewVersionCommit[] }) {
  const [open, setOpen] = useState(true);
  const locateCommit = useNewVersionStore((s) => s.locateCommit);

  return (
    <section className="new-version-section">
      <button
        type="button"
        className="new-version-collapsible-header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`new-version-chevron${open ? " open" : ""}`}>
          <ChevronIcon />
        </span>
        <span>{t("Commits for New Version")}</span>
        <span className="new-version-count-badge">{commits.length}</span>
      </button>

      {open &&
        (commits.length === 0 ? (
          <div className="new-version-empty">{t("No new commits since last version")}</div>
        ) : (
          <>
            <div className="new-version-commit-list">
              {commits.map((c) => (
                <div
                  key={c.hash}
                  className="new-version-commit-row"
                  title={c.subject}
                  onClick={() => locateCommit(c.hash)}
                >
                  <span className="new-version-commit-subject">{c.subject}</span>
                  <span className="new-version-commit-meta">
                    {c.author} · {c.shortDate}
                  </span>
                </div>
              ))}
            </div>
          </>
        ))}
    </section>
  );
}
