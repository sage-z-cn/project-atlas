import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import type { Commit, RepoInfo, RepoStatus } from "../../shared/types/git";
import { ModalOverlay } from "./Modal";
import CloseIcon from "~icons/codicon/close";
import ChevronRightIcon from "~icons/codicon/chevron-right";

// ── Push-repositories selection modal ────────────────────────────────────────
// 打开入口：VSCode view/title 命令 git-atlas.pushAllRepos → 后端广播
// showPushAllReposDialog → 本组件挂载。确认后调用 pushAllRepos 串行推送
// 选中仓库的当前分支，结果在弹窗内汇总展示。
// 每行显示本地分支 → 远程分支、待推送提交数（↑N），可展开懒加载提交列表。
// 禁选 = 无远程（hasRemote）；默认勾选 = 有 upstream 且 ahead > 0；无
// upstream（新建分支）/ ahead=0 默认不勾但可手动勾选。

interface PushResult {
  pushed: string[];
  skipped: string[];
  failed: { repoPath: string; name: string; error: string }[];
}

/** 展开区缓存：undefined = 未加载；null = 加载失败；Commit[] = 已加载。 */
type AheadCache = Map<string, Commit[] | null>;

/** 默认勾选：有 upstream 且 ahead > 0 的仓库。 */
function pickDefaultSelected(
  repos: RepoInfo[],
  statuses: Record<string, RepoStatus>,
): Set<string> {
  const paths = new Set<string>();
  for (const repo of repos) {
    const s = statuses[repo.path];
    if (s?.upstream && typeof s.ahead === "number" && s.ahead > 0) {
      paths.add(repo.path);
    }
  }
  return paths;
}

export function PushAllReposModal() {
  const [open, setOpen] = useState(false);
  const repos = useCommitStore((s) => s.repos);
  const repoStatuses = useCommitStore((s) => s.repoStatuses);
  const fetchRepos = useCommitStore((s) => s.fetchRepos);
  const fetchRepoStatuses = useCommitStore((s) => s.fetchRepoStatuses);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [aheadCommits, setAheadCommits] = useState<AheadCache>(new Map());
  const [loadingAhead, setLoadingAhead] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  /** 用户是否手动改过勾选；fetch 完成后据此决定是否重算默认。 */
  const userTouched = useRef(false);

  const applyDefaults = useCallback(() => {
    const state = useCommitStore.getState();
    setSelected(pickDefaultSelected(state.repos, state.repoStatuses));
  }, []);

  // 打开时：先按现有 statuses 给默认勾选，再重拉。fetch 完成后若用户
  // 尚未交互，按最新 statuses 重算（打开瞬间 statuses 可能尚未就绪）。
  const openDialog = useCallback(async () => {
    setResult(null);
    setPushing(false);
    setExpanded(new Set());
    setAheadCommits(new Map());
    setLoadingAhead(new Set());
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
      if (event === "showPushAllReposDialog") {
        void openDialog();
      }
    });
  }, [openDialog]);

  // 打开时 store 尚无 statuses → fetch 返回后补齐默认勾选。
  useEffect(() => {
    if (!open || userTouched.current || repos.length === 0) return;
    if (Object.keys(repoStatuses).length === 0) return;
    setSelected((prev) =>
      prev.size === 0 ? pickDefaultSelected(repos, repoStatuses) : prev,
    );
  }, [open, repos, repoStatuses]);

  const close = useCallback(() => {
    if (pushing) return;
    setOpen(false);
  }, [pushing]);

  const toggle = useCallback((path: string) => {
    if (useCommitStore.getState().repoStatuses[path]?.hasRemote !== true)
      return;
    userTouched.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // 全选只作用于可选仓库（已配置远程）。
  const selectablePaths = repos
    .filter((r) => repoStatuses[r.path]?.hasRemote === true)
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
          (r) => useCommitStore.getState().repoStatuses[r.path]?.hasRemote === true,
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

  /** 展开某仓库：懒加载 ahead commits（首次展开或缓存缺失时）。 */
  const toggleExpand = useCallback(
    (repo: RepoInfo) => {
      const path = repo.path;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
          return next;
        }
        next.add(path);
        return next;
      });
      // 已有缓存（含失败 null）不再重复请求。
      if (aheadCommits.has(path) || loadingAhead.has(path)) return;
      const branch = repoStatuses[path]?.branch;
      if (!branch) return;
      setLoadingAhead((prev) => new Set(prev).add(path));
      void (async () => {
        try {
          const res = (await bridge.request("getAheadCommits", {
            repoPath: path,
            branchName: branch,
          })) as { commits?: Commit[] } | null;
          setAheadCommits((prev) => {
            const next = new Map(prev);
            next.set(path, res?.commits ?? []);
            return next;
          });
        } catch {
          setAheadCommits((prev) => {
            const next = new Map(prev);
            next.set(path, null);
            return next;
          });
        } finally {
          setLoadingAhead((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
      })();
    },
    [aheadCommits, loadingAhead, repoStatuses],
  );

  const confirm = useCallback(async () => {
    if (selected.size === 0 || pushing) return;
    setPushing(true);
    setResult(null);
    try {
      const res = (await bridge.request(
        "pushAllRepos",
        { repoPaths: Array.from(selected) },
        // 串行推送多个仓库，网络耗时不可预估；与 commitAndPush 对齐到 120s。
        { timeout: 120_000 },
      )) as PushResult | null;
      if (res) {
        setResult({
          pushed: res.pushed ?? [],
          skipped: res.skipped ?? [],
          failed: res.failed ?? [],
        });
      }
      // 推送后 ahead 列表与徽章会过期：清空缓存并收起展开行（避免已展
      // 开行停在 Loading），再刷新徽章。
      setAheadCommits(new Map());
      setExpanded(new Set());
      void fetchRepoStatuses();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({
        pushed: [],
        skipped: [],
        failed: [{ repoPath: "", name: "", error: msg }],
      });
    } finally {
      setPushing(false);
    }
  }, [selected, pushing, fetchRepoStatuses]);

  if (!open) return null;

  const nameOf = (path: string) =>
    repos.find((r) => r.path === path)?.name ?? path;

  return (
    <ModalOverlay onClose={close} ariaLabel={t("Push Repositories")}>
      <div className="new-version-modal-head">
        <span className="new-version-modal-title">
          {t("Push Repositories")}
        </span>
        <button
          type="button"
          className="commit-error-close"
          aria-label={t("Cancel")}
          onClick={close}
          disabled={pushing}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="new-version-prompt-help">
        {t(
          "Select repositories to push. The current branch of each repo will be pushed.",
        )}
      </div>

      {repos.length === 0 ? (
        <div className="push-all-empty">{t("No repositories found")}</div>
      ) : (
        <div
          className="push-all-panel"
          role="group"
          aria-label={t("Push Repositories")}
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
              disabled={pushing || selectablePaths.length === 0}
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
            const isExpanded = expanded.has(repo.path);
            const ahead = status?.ahead;
            const commits = aheadCommits.get(repo.path);
            const isLoading = loadingAhead.has(repo.path);
            // 无远程：禁止勾选与展开（无 upstream 的新建分支仍可选可展
            // 开——push 用显式 refspec，首次推送可行）。
            const selectable = status?.hasRemote === true;
            // 有上游用徽章计数；无上游（ahead=null）在展开加载后用列表
            // 长度回填，避免一直显示 "—"。
            const aheadCount =
              typeof ahead === "number"
                ? ahead
                : Array.isArray(commits)
                  ? commits.length
                  : null;
            const canExpand = selectable && !!status?.branch;

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
                    disabled={pushing || !selectable}
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
                          ? `${status.branch} → ${status.upstream}`
                          : status.branch
                      }
                    >
                      {status.branch}
                      {status.upstream && (
                        <>
                          <span className="push-all-branch-arrow">→</span>
                          <span className="push-all-upstream">
                            {status.upstream}
                          </span>
                        </>
                      )}
                    </span>
                  )}
                  {aheadCount !== null ? (
                    <span
                      className={`push-all-ahead${aheadCount > 0 ? "" : " push-all-ahead-zero"}`}
                      title={t("{0} commit(s) to push", aheadCount)}
                    >
                      ↑{aheadCount}
                    </span>
                  ) : status ? (
                    <span className="push-all-ahead push-all-ahead-zero">—</span>
                  ) : null}
                  {canExpand && (
                    <button
                      type="button"
                      className={`push-all-expand${isExpanded ? " open" : ""}`}
                      aria-expanded={isExpanded}
                      aria-label={
                        isExpanded ? t("Collapse") : t("Expand commits")
                      }
                      disabled={pushing}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleExpand(repo);
                      }}
                    >
                      <ChevronRightIcon />
                    </button>
                  )}
                </div>
                {isExpanded && (
                  <div className="push-all-commits">
                    {isLoading || commits === undefined ? (
                      <div className="push-all-commits-msg">
                        {t("Loading...")}
                      </div>
                    ) : commits === null ? (
                      <div className="push-all-commits-msg">
                        {t("Failed to load commits")}
                      </div>
                    ) : commits.length === 0 ? (
                      <div className="push-all-commits-msg">
                        {t("No commits to push")}
                      </div>
                    ) : (
                      <ul className="push-all-commit-list">
                        {commits.map((c) => (
                          <li key={c.hash} className="push-all-commit-item">
                            <span
                              className="push-all-commit-subject"
                              title={c.subject}
                            >
                              {c.subject}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {result && (
        <div className="push-all-result" role="status">
          {result.pushed.length > 0 && (
            <div className="push-all-result-line">
              {t("Pushed: {0}", result.pushed.map(nameOf).join(", "))}
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
          disabled={pushing}
        >
          {result ? t("Close") : t("Cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void confirm()}
          disabled={pushing || selected.size === 0 || repos.length === 0}
        >
          {pushing
            ? t("Pushing...")
            : result
              ? t("Push Again")
              : t("Push")}
        </button>
      </div>
    </ModalOverlay>
  );
}
