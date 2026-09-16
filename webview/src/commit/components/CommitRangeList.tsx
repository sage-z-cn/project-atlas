import { useState } from "react";
import { t } from "../../shared/i18n";
import { formatRelativeTime } from "../../shared/utils/relativeTime";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { useNewVersionStore } from "../../shared/store/new-version-store";
import type { NewVersionCommit } from "../../shared/store/new-version-store";
import ChevronDownIcon from "~icons/codicon/chevron-down";
import ChevronRightIcon from "~icons/codicon/chevron-right";

export function CommitRangeList({ commits }: { commits: NewVersionCommit[] }) {
  const [open, setOpen] = useState(true);
  const locateCommit = useNewVersionStore((s) => s.locateCommit);
  const toggleCommitSelected = useNewVersionStore((s) => s.toggleCommitSelected);
  const setAllCommitsSelected = useNewVersionStore(
    (s) => s.setAllCommitsSelected,
  );
  const selectedCommitHashes = useNewVersionStore((s) => s.selectedCommitHashes);

  if (commits.length === 0) {
    return (
      <section className="new-version-section">
        <div className="new-version-empty">
          {t("No new commits since last version")}
        </div>
      </section>
    );
  }

  const selectedCount = commits.filter((c) =>
    selectedCommitHashes.includes(c.hash),
  ).length;
  const allSelected = selectedCount === commits.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <section className="new-version-section">
      {/* 与 commit 面板 toolbar 同视觉：全选 + 标题 + 计数在左，展开/收起在右。 */}
      <div className="commit-toolbar new-version-range-toolbar">
        <input
          type="checkbox"
          className="new-version-range-check"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={() => setAllCommitsSelected(!allSelected)}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("Select All")}
        />
        <span className="new-version-section-title">
          {t("Changelog generation scope")}
        </span>
        <span
          className="new-version-count-text"
          title={t("Selected {0} of {1} commits", selectedCount, commits.length)}
        >
          {selectedCount}/{commits.length}
        </span>
        <div className="commit-toolbar-spacer" />
        <Tooltip text={open ? t("Collapse") : t("Expand")}>
          <button
            type="button"
            className="commit-toolbar-btn"
            aria-expanded={open}
            aria-label={open ? t("Collapse") : t("Expand")}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
        </Tooltip>
      </div>

      {open && (
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
                {c.author} · {formatRelativeTime(c.date)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
