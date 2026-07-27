import { useState } from "react";
import { bridge } from "../bridge";
import { t } from "../i18n";
import RepoIcon from "~icons/codicon/repo";
import LoadingIcon from "~icons/codicon/loading";
import "./EmptyRepoState.css";

interface InitializeRepositoryResult {
  success: boolean;
  repoPath?: string;
  error?: string;
}

/**
 * Shared empty-state card shown when the workspace has no Git repositories.
 *
 * Rendered by both the commit panel (commit/App.tsx) and the Git Log panel
 * (panel/App.tsx) once their respective stores have completed the ready
 * handshake (`repoInitialized === true`) and confirmed `repos.length === 0`.
 *
 * The "Initialize Git Repository" button issues the host `initializeRepository`
 * request. On success the host rescans the workspace and broadcasts
 * `reposChanged`; each store's event listener refreshes `repos`, which flips
 * `repos.length > 0` and unmounts this card. We therefore keep the button in
 * its loading state on success rather than resetting it, avoiding a flash of
 * the idle button before the event lands. On failure the inline error banner
 * surfaces the host's error message and the button resets so the user can
 * retry.
 *
 * Note: events in this webview are dispatched as raw strings (see
 * Bridge.onEvent) — there is no formal EventType union, consistent with the
 * existing repoChanged / gitStateChanged handling.
 */
export function EmptyRepoState() {
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInitialize = async () => {
    if (initializing) return;
    setInitializing(true);
    setError(null);
    try {
      const result = (await bridge.request("initializeRepository", {})) as
        | InitializeRepositoryResult
        | null;
      if (result && !result.success) {
        const message = result.error ?? t("Unknown error");
        setError(t("Failed to initialize Git repository: {0}", message));
        setInitializing(false);
      }
      // Success: keep loading state. The host broadcasts reposChanged → the
      // store updates repos → this card unmounts. No manual reset needed.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t("Failed to initialize Git repository: {0}", message));
      setInitializing(false);
    }
  };

  return (
    <div className="repo-empty-root">
      <div className="repo-empty-card">
        <div className="repo-empty-icon" aria-hidden="true">
          <RepoIcon width={48} height={48} />
        </div>
        <h2 className="repo-empty-title">{t("No Git repository found")}</h2>
        <p className="repo-empty-desc">
          {t(
            "Initialize a Git repository to start tracking changes in this workspace.",
          )}
        </p>
        <button
          type="button"
          className="repo-empty-btn"
          onClick={() => void handleInitialize()}
          disabled={initializing}
        >
          {initializing ? (
            <>
              <LoadingIcon
                width={14}
                height={14}
                className="repo-empty-spin"
              />
              <span>{t("Initializing...")}</span>
            </>
          ) : (
            <span>{t("Initialize Git Repository")}</span>
          )}
        </button>
        {error && (
          <div className="repo-empty-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
