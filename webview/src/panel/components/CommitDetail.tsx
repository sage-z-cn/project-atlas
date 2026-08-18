import { CommitInfo } from "../../shared/components/CommitInfo";
import { t } from "../../shared/i18n";
import { usePanelStore } from "../../shared/store/panel-store";
import type { Commit } from "../../shared/types/git";

/**
 * @param headerReserveRight Reserve space to the right of the FIRST commit's
 *   subject line, keeping it clear of the floating action buttons that
 *   overlay the detail panel's top-right in bottom-dock mode. Only the first
 *   (topmost) header can collide with them; other content renders full width.
 */
export function CommitDetail({
  headerReserveRight = 0,
}: {
  headerReserveRight?: number;
}) {
  const commits = usePanelStore((s) => s.commits);
  const selectedCommitHashes = usePanelStore((s) => s.selectedCommitHashes);

  const selectedCommits = selectedCommitHashes
    .map((h) => commits.find((c) => c.hash === h))
    .filter((c): c is Commit => c != null);

  if (selectedCommits.length === 0) {
    return (
      <div style={{ padding: 12, opacity: 0.5 }}>
        {t("Select a commit to view details")}
      </div>
    );
  }

  return (
    <div style={{ padding: 12, overflow: "auto", overflowX: "hidden" }}>
      {selectedCommits.map((commit, i) => (
        <div key={commit.hash}>
          {i > 0 && (
            <hr
              style={{
                border: "none",
                borderTop: "1px solid var(--border)",
                margin: "10px 0",
              }}
            />
          )}
          <CommitInfo
            commit={commit}
            subjectReserveRight={i === 0 ? headerReserveRight : 0}
          />
        </div>
      ))}
    </div>
  );
}
