import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import type { RepoInfo, RepoStatus } from "../../shared/types/git";
import { ModalOverlay } from "./Modal";
import CloseIcon from "~icons/codicon/close";

// ── Pull-repositories selection modal ────────────────────────────────────────
// 与 PushAllReposModal 同构，但不提供展开查看提交。默认勾选：有远程跟踪
// 分支且 behind > 0。确认后调用 pullAllRepos 串行拉取选中仓库。

interface PullResult {
  pulled: string[];
  skipped: string[];
  failed: { repoPath: string; name: string; error: string }[];
}

/** 默认勾选：有 upstream 且 behind > 0 的仓库。 */
function pickDefaultSelected(
  repos: RepoInfo[],
  statuses: Record<string, RepoStatus>,
): Set<string> {
  const paths = new Set<string>();
  for (const repo of repos) {
    const s = statuses[repo.path];
    if (s?.upstream && typeof s.behind === "number" && s.behind > 0) {
      paths.add(repo.path);
    }
  }
  return paths;
}

export function PullAllReposModal() {
  const [open, setOpen] = useState(false);
  const repos = useCommitStore((s) => s.repos);
  const repoStatuses = useCommitStore((s) => s.repoStatuses);
  const fetchRepos = useCommitStore((s) => s.fetchRepos);
  const fetchRepoStatuses = useCommitStore((s) => s.fetchRepoStatuses);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [result, setResult] = useState<PullResult | null>(null);
  const userTouched = useRef(false);

  const applyDefaults = useCallback(() => {
    const state = useCommitStore.getState();
    setSelected(pickDefaultSelected(state.repos, state.repoStatuses));
  }, []);

  const openDialog = useCallback(async () => {
    setResult(null);
    setPulling(false);
    userTouched.current = false;
    applyDefaults();
    setOpen(true);
    await Promise.all([fetchRepos(), fetchRepoStatuses()]);
    if (!userTouched.current) {
      applyDefaults();
    }
  }, [fetchRepos, fetchRepoStatuses, applyDefaults]);

  useEffect(() => {
    return bridge.onEvent((event) => {
      if (event === "showPullAllReposDialog") {
        void openDialog();
      }
    });
  }, [openDialog]);

  useEffect(() => {
    if (!open || userTouched.current || repos.length === 0) return;
    if (Object.keys(repoStatuses).length === 0) return;
    setSelected((prev) =>
      prev.size === 0 ? pickDefaultSelected(repos, repoStatuses) : prev,
    );
  }, [open, repos, repoStatuses]);

  const close = useCallback(() => {
    if (pulling) return;
    setOpen(false);
  }, [pulling]);

  const toggle = useCallback((path: string) => {
    if (!useCommitStore.getState().repoStatuses[path]?.upstream) return;
    userTouched.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // 全选只作用于可选仓库（有远程跟踪分支）。
  const selectablePaths = repos
    .filter((r) => !!repoStatuses[r.path]?.upstream)
    .map((r) => r.path);
  const allSelectableSelected =
    selectablePaths.length > 0 &&
    selectablePaths.every((p) => selected.has(p));
  const toggleAll = useCallback(() => {
    userTouched.current = true;
    setSelected((prev) => {
      const selectable = useCommitStore
        .getState()
        .repos.filter(
          (r) => !!useCommitStore.getState().repoStatuses[r.path]?.upstream,
        )
        .map((r) => r.path);
      const allOn =
        selectable.length > 0 && selectable.every((p) => prev.has(p));
      if (allOn) {
        const next = new Set(prev);
        for (const p of selectable) next.delete(p);
        return next;
      }
      return new Set([...prev, ...selectable]);
    });
  }, []);

  const confirm = useCallback(async () => {
    if (selected.size === 0 || pulling) return;
    setPulling(true);
    setResult(null);
    try {
      const res = (await bridge.request(
        "pullAllRepos",
        { repoPaths: Array.from(selected) },
        // 串行拉取多个仓库，网络耗时不可预估。
        { timeout: 120_000 },
      )) as PullResult | null;
      if (res) {
        setResult({
          pulled: res.pulled ?? [],
          skipped: res.skipped ?? [],
          failed: res.failed ?? [],
        });
      }
      await fetchRepoStatuses();
      // 徽章刷新后按最新 behind 重算勾选：已拉完（behind=0）的自动取消。
      userTouched.current = false;
      applyDefaults();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({
        pulled: [],
        skipped: [],
        failed: [{ repoPath: "", name: "", error: msg }],
      });
    } finally {
      setPulling(false);
    }
  }, [selected, pulling, fetchRepoStatuses, applyDefaults]);

  if (!open) return null;

  const nameOf = (path: string) =>
    repos.find((r) => r.path === path)?.name ?? path;

  return (
    <ModalOverlay onClose={close} ariaLabel={t("Pull Repositories")}>
      <div className="new-version-modal-head">
        <span className="new-version-modal-title">
          {t("Pull Repositories")}
        </span>
        <button
          type="button"
          className="commit-message-banner-close"
          aria-label={t("Cancel")}
          onClick={close}
          disabled={pulling}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="new-version-prompt-help">
        {t(
          "Select repositories to pull. The current branch of each repo will be pulled.",
        )}
      </div>

      {repos.length === 0 ? (
        <div className="push-all-empty">{t("No repositories found")}</div>
      ) : (
        <div
          className="push-all-panel"
          role="group"
          aria-label={t("Pull Repositories")}
        >
          <label className="push-all-row push-all-row-master">
            <input
              type="checkbox"
              checked={allSelectableSelected}
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    selected.size > 0 && !allSelectableSelected;
              }}
              onChange={toggleAll}
              disabled={pulling || selectablePaths.length === 0}
            />
            <span className="push-all-name">{t("Select All")}</span>
            <span className="push-all-meta">
              {t("{0} selected", selected.size)}
            </span>
          </label>
          <div className="push-all-list">
            {repos.map((repo: RepoInfo) => {
              const status = repoStatuses[repo.path];
              const checked = selected.has(repo.path);
              const behind = status?.behind;
              // 无远程跟踪分支：禁止勾选（拉取必然 skipped）。
              const selectable = !!status?.upstream;

              return (
                <div
                  key={repo.path}
                  className={`push-all-item${selectable ? "" : " push-all-item-disabled"}`}
                >
                  <div className="push-all-row">
                    <input
                      type="checkbox"
                      checked={checked && selectable}
                      onChange={() => toggle(repo.path)}
                      disabled={pulling || !selectable}
                      aria-label={repo.name}
                    />
                    <span className="push-all-name" title={repo.path}>
                      {repo.name}
                    </span>
                    {status?.branch && (
                      <span
                        className="push-all-branch"
                        title={
                          status.upstream
                            ? `${status.upstream} → ${status.branch}`
                            : status.branch
                        }
                      >
                        {status.upstream ? (
                          <>
                            <span className="push-all-upstream">
                              {status.upstream}
                            </span>
                            <span className="push-all-branch-arrow">→</span>
                            <span>{status.branch}</span>
                          </>
                        ) : (
                          status.branch
                        )}
                      </span>
                    )}
                    {typeof behind === "number" ? (
                      <span
                        className={`push-all-ahead${behind > 0 ? "" : " push-all-ahead-zero"}`}
                        title={t("{0} commit(s) to pull", behind)}
                      >
                        ↓{behind}
                      </span>
                    ) : status ? (
                      <span className="push-all-ahead push-all-ahead-zero">
                        —
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {result && (
        <div className="push-all-result" role="status">
          {result.pulled.length > 0 && (
            <div className="push-all-result-line">
              {t("Pulled: {0}", result.pulled.map(nameOf).join(", "))}
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="push-all-result-line push-all-result-skipped">
              {t(
                "Skipped (no remote or detached HEAD): {0}",
                result.skipped.map(nameOf).join(", "),
              )}
            </div>
          )}
          {result.failed.length > 0 && (
            <div className="push-all-result-line push-all-result-failed">
              {t(
                "Failed: {0}",
                result.failed
                  .map((f) => `${f.name}: ${f.error}`)
                  .join("; "),
              )}
            </div>
          )}
        </div>
      )}

      <div className="new-version-prompt-actions">
        <span className="new-version-prompt-spacer" />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={close}
          disabled={pulling}
        >
          {result ? t("Close") : t("Cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void confirm()}
          disabled={pulling || selected.size === 0 || repos.length === 0}
        >
          {pulling ? t("Pulling...") : t("Pull")}
        </button>
      </div>
    </ModalOverlay>
  );
}
