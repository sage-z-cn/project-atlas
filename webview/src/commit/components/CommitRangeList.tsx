import { useState } from "react";
import { t } from "../../shared/i18n";
import { useNewVersionStore } from "../../shared/store/new-version-store";
import type { NewVersionCommit } from "../../shared/store/new-version-store";
import ChevronIcon from "~icons/codicon/chevron-right";

export function CommitRangeList({ commits }: { commits: NewVersionCommit[] }) {
  const [open, setOpen] = useState(true);
  const locateCommit = useNewVersionStore((s) => s.locateCommit);
  const toggleCommitSelected = useNewVersionStore((s) => s.toggleCommitSelected);
  const selectedCommitHashes = useNewVersionStore((s) => s.selectedCommitHashes);

  const selectedCount = commits.filter((c) =>
    selectedCommitHashes.includes(c.hash),
  ).length;

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
        <span
          className="new-version-count-badge"
          title={t("Selected {0} of {1} commits", selectedCount, commits.length)}
        >
          {selectedCount}/{commits.length}
        </span>
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
                  <input
                    type="checkbox"
                    className="new-version-commit-check"
                    checked={selectedCommitHashes.includes(c.hash)}
                    aria-label={t("Include in changelog generation")}
                    title={t("Include in changelog generation")}
                    // Keep the row's locate-click out of the checkbox hit.
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleCommitSelected(c.hash)}
                  />
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
