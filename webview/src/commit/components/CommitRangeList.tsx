import { useState } from "react";
import { t } from "../../shared/i18n";
import { useReleaseStore } from "../../shared/store/release-store";
import type { ReleaseCommit } from "../../shared/store/release-store";
import ChevronIcon from "~icons/codicon/chevron-right";

export function CommitRangeList({ commits }: { commits: ReleaseCommit[] }) {
  const [open, setOpen] = useState(true);
  const locateCommit = useReleaseStore((s) => s.locateCommit);

  return (
    <section className="release-section">
      <button
        type="button"
        className="release-collapsible-header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`release-chevron${open ? " open" : ""}`}>
          <ChevronIcon />
        </span>
        <span>{t("Commits to Release")}</span>
        <span className="release-count-badge">{commits.length}</span>
      </button>

      {open &&
        (commits.length === 0 ? (
          <div className="release-empty">{t("No new commits since last version")}</div>
        ) : (
          <>
            <div className="release-commit-list">
              {commits.map((c) => (
                <div
                  key={c.hash}
                  className="release-commit-row"
                  title={c.subject}
                  onClick={() => locateCommit(c.hash)}
                >
                  <span className="release-commit-subject">{c.subject}</span>
                  <span className="release-commit-meta">
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
