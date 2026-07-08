import { useCommitStore } from "../store/commit-store";
import { usePanelStore } from "../store/panel-store";
import type { RepoInfo, RepoStatus } from "../types/git";
import "./RepoSelector.css";

interface Props {
  /** Which store backs this selector — each webview owns its own store, but
   *  both listen to the host-broadcast repoChanged event so they stay in sync. */
  store: "panel" | "commit";
}

/**
 * Repo chip list for picking the active repo (phase B').
 *
 * Orientation adapts to the host container: the bottom panel (panel mode) is
 * wide, so chips lay out horizontally; the sidebar (commit mode) is narrow and
 * vertical, so chips stack vertically. The container is determined by the
 * view's `mode` (package.json views maps gitLog→panel, commitPanel→activitybar),
 * so we derive orientation from the store rather than detecting layout at runtime.
 *
 * Renders nothing for a single-repo workspace (`repos.length <= 1`) — there's
 * nothing to choose, so we avoid taking space. With multiple repos the chips
 * scroll (overflow) rather than collapsing to a dropdown, to keep every repo
 * one click away.
 *
 * Clicking a chip calls `switchRepo`, which only issues the host `switchRepo`
 * command. The host then broadcasts `repoChanged`, which both stores listen for
 * (clearing per-repo state + refetching). No optimistic local update — the host
 * is the source of truth for the active repo.
 */
export function RepoSelector({ store }: Props) {
  return store === "panel" ? <PanelRepoSelector /> : <CommitRepoSelector />;
}

function PanelRepoSelector() {
  return (
    <RepoSelectorBody
      repos={usePanelStore((s) => s.repos)}
      currentRepoPath={usePanelStore((s) => s.currentRepoPath)}
      switchRepo={usePanelStore((s) => s.switchRepo)}
      repoStatuses={usePanelStore((s) => s.repoStatuses)}
      orientation="horizontal"
    />
  );
}

function CommitRepoSelector() {
  return (
    <RepoSelectorBody
      repos={useCommitStore((s) => s.repos)}
      currentRepoPath={useCommitStore((s) => s.currentRepoPath)}
      switchRepo={useCommitStore((s) => s.switchRepo)}
      repoStatuses={useCommitStore((s) => s.repoStatuses)}
      orientation="vertical"
    />
  );
}

interface BodyProps {
  repos: RepoInfo[];
  currentRepoPath: string | null;
  switchRepo: (path: string) => Promise<void>;
  /** Per-repo ahead/behind/dirty counts keyed by repo path (for chip badges). */
  repoStatuses: Record<string, RepoStatus>;
  /** Layout direction: "horizontal" for the bottom panel (wide), "vertical" for the sidebar (narrow). */
  orientation: "horizontal" | "vertical";
}

function RepoSelectorBody({
  repos,
  currentRepoPath,
  switchRepo,
  repoStatuses,
  orientation,
}: BodyProps) {
  // Single-repo workspace: nothing to choose, hide the selector entirely.
  if (repos.length <= 1) return null;

  return (
    <div className={`repo-selector ${orientation}`}>
      {repos.map((repo) => (
        <button
          key={repo.path}
          type="button"
          className={`repo-chip ${
            repo.path === currentRepoPath ? "active" : ""
          }`}
          title={repo.path}
          onClick={() => void switchRepo(repo.path)}
        >
          <RepoIcon />
          <span className="repo-name">{repo.name}</span>
          <RepoBadges status={repoStatuses[repo.path]} />
        </button>
      ))}
    </div>
  );
}

/**
 * ahead/behind/dirty badge cluster. Each badge renders only when its count is
 * truthy: `null` (no upstream / detached HEAD) hides ↑↓, and `0` hides any of
 * them. When all are zero/null the whole cluster is absent and the chip shows
 * only the repo name.
 */
function RepoBadges({ status }: { status?: RepoStatus }) {
  if (!status) return null;
  const { ahead, behind, dirty } = status;
  // Avoid rendering an empty badges wrapper when everything is hidden.
  if (!ahead && !behind && !dirty) return null;
  return (
    <span className="repo-badges">
      {ahead ? (
        <span className="badge ahead" title={`待推送 ${ahead} 个提交`}>
          ↑{ahead}
        </span>
      ) : null}
      {behind ? (
        <span className="badge behind" title={`待拉取 ${behind} 个提交`}>
          ↓{behind}
        </span>
      ) : null}
      {dirty ? (
        <span className="badge dirty" title={`${dirty} 个未提交文件`}>
          ●{dirty}
        </span>
      ) : null}
    </span>
  );
}

function RepoIcon() {
  // Inline SVG (the webview uses inline SVG glyphs throughout — no codicon font
  // is loaded in the webview bundle).
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 1.5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 3 14.5h10a1.5 1.5 0 0 0 1.5-1.5V3A1.5 1.5 0 0 0 13 1.5H3z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <path d="M5.5 1.5v13" stroke="currentColor" />
      <circle cx="5.5" cy="5" r="0.9" fill="currentColor" />
    </svg>
  );
}
