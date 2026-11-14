import { useEffect, useRef, useState } from "react";
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

interface DeepScanResult {
  success: boolean;
  /** Repos discovered by this scan. */
  found?: number;
  /** Total repos after the scan. */
  total?: number;
  error?: string;
}

interface RepoScanState {
  scanning: boolean;
  found?: number;
  total?: number;
}

/** Deeper folder walks can take far longer than the bridge's default timeout. */
const DEEP_SCAN_TIMEOUT_MS = 120_000;

/**
 * Shared empty-state card shown when the workspace has no Git repositories.
 *
 * Rendered by both the commit panel (commit/App.tsx) and the Git Log panel
 * (panel/App.tsx) once their respective stores have completed the ready
 * handshake (`repoInitialized === true`) and confirmed `repos.length === 0`.
 *
 * Two actions live here, one primary and one secondary:
 *  - "Initialize Git Repository" issues the host `initializeRepository`
 *    request. On success the host rescans the workspace and broadcasts
 *    `reposChanged`; each store's event listener refreshes `repos`, which
 *    flips `repos.length > 0` and unmounts this card. We therefore keep the
 *    button in its loading state on success rather than resetting it, avoiding
 *    a flash of the idle button before the event lands.
 *  - "Deep Scan (up to 3 levels)" issues `deepScanRepos`. The same
 *    `reposChanged` handoff unmounts the card when new repos were found, so a
 *    scan that reports `found > 0` also keeps its scanning state. A scan that
 *    finds nothing returns to idle and leaves a neutral note; failures reuse
 *    the inline error banner.
 *
 * Only one action may run at a time: both buttons disable while either request
 * is in flight, so a deep scan and a `git init` never race.
 *
 * Deep scans can also be started from the view/title command, so the scanning
 * state is driven by the host's `repoScanStateChanged` event rather than by
 * the button's request alone. Either entry point produces the same animation.
 *
 * Note: events in this webview are dispatched as raw strings (see
 * Bridge.onEvent) — there is no formal EventType union, consistent with the
 * existing repoChanged / gitStateChanged handling.
 */
export function EmptyRepoState() {
  const [initializing, setInitializing] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** True after a finished scan that discovered no new repositories. */
  const [scanEmpty, setScanEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True while this card's own deep-scan request is awaiting its response. */
  const ownScanPending = useRef(false);

  const busy = initializing || scanning;

  useEffect(() => {
    return bridge.onEvent((event, data) => {
      if (event !== "repoScanStateChanged") return;
      const state = data as RepoScanState | null;
      if (!state || typeof state.scanning !== "boolean") return;

      if (state.scanning) {
        setScanning(true);
        setScanEmpty(false);
        setError(null);
        return;
      }

      // Repos were found: the host broadcasts reposChanged right after, the
      // stores refresh, and this card unmounts. Keep the scanning state so the
      // idle card never flashes back before that happens.
      if ((state.found ?? 0) > 0) return;

      setScanning(false);
      // A locally started scan settles its result from the request response,
      // which lands right after this event; only scans started elsewhere
      // (view/title command) need the event itself to report the outcome.
      if (state.found === 0 && !ownScanPending.current) setScanEmpty(true);
    });
  }, []);

  const handleInitialize = async () => {
    if (busy) return;
    setInitializing(true);
    setError(null);
    setScanEmpty(false);
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

  const handleDeepScan = async () => {
    if (busy) return;
    setScanning(true);
    setScanEmpty(false);
    setError(null);
    ownScanPending.current = true;
    try {
      const result = (await bridge.request(
        "deepScanRepos",
        {},
        { timeout: DEEP_SCAN_TIMEOUT_MS },
      )) as DeepScanResult | null;
      if (result && !result.success) {
        const message = result.error ?? t("Unknown error");
        setError(t("Failed to scan deeper folders: {0}", message));
        setScanning(false);
        return;
      }
      // found > 0 → reposChanged unmounts the card; keep the scanning state.
      if ((result?.found ?? 0) === 0) {
        setScanning(false);
        setScanEmpty(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t("Failed to scan deeper folders: {0}", message));
      setScanning(false);
    } finally {
      ownScanPending.current = false;
    }
  };

  return (
    <div className="repo-empty-root">
      <div className="repo-empty-card" aria-busy={busy}>
        <div
          className={`repo-empty-icon${scanning ? " scanning" : ""}`}
          aria-hidden="true"
        >
          <RepoIcon width={48} height={48} />
        </div>
        <h2 className="repo-empty-title">{t("No Git repository found")}</h2>
        <p className="repo-empty-desc">
          {t(
            "Initialize a Git repository to start tracking changes in this workspace.",
          )}
        </p>
        <div className="repo-empty-actions">
          <button
            type="button"
            className="repo-empty-btn"
            onClick={() => void handleInitialize()}
            disabled={busy}
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
          <button
            type="button"
            className="repo-empty-btn repo-empty-btn-secondary"
            onClick={() => void handleDeepScan()}
            disabled={busy}
          >
            {scanning ? (
              <>
                <LoadingIcon
                  width={14}
                  height={14}
                  className="repo-empty-spin"
                />
                <span>{t("Scanning deeper folders...")}</span>
              </>
            ) : (
              <span>{t("Deep Scan (up to 3 levels)")}</span>
            )}
          </button>
        </div>
        {scanEmpty && !error && (
          <div className="repo-empty-notice" role="status">
            {t("No Git repository found in deeper folders.")}
          </div>
        )}
        {error && (
          <div className="repo-empty-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
