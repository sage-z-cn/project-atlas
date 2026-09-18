import { useState } from "react";
import { bridge } from "../bridge";
import { useCommitStore } from "../store/commit-store";
import { usePanelStore } from "../store/panel-store";
import type { RepoInfo, RepoStatus } from "../types/git";
import { applyRepoOrder } from "../utils/repoOrder";
import { t } from "../i18n";
import RepoIcon from "~icons/codicon/repo";
import RepoSelectedIcon from "~icons/codicon/repo-selected";
import BranchIcon from "~icons/codicon/git-branch";
import { RepoContextMenu } from "./RepoContextMenu";
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
 * vertical, so chips stack vertically.
 *
 * Multi-repo chips are draggable to reorder the list; the new order is
 * persisted host-side under `gitAtlas.repoOrder` and shared across both views.
 * Right-click also offers direction-aware move actions (Left/Right in the
 * horizontal panel strip, Up/Down in the vertical sidebar) for precise tweaks.
 */
export function RepoSelector({ store }: Props) {
  return store === "panel" ? <PanelRepoSelector /> : <CommitRepoSelector />;
}

/** Persist display order + optimistically mirror it into the given store. */
async function persistRepoOrder(
  store: "panel" | "commit",
  order: string[],
): Promise<void> {
  try {
    const res = (await bridge.request("setRepoOrder", { order })) as {
      success?: boolean;
      repos?: RepoInfo[];
    };

    // 响应带完整列表时直接作为 incoming；否则回退用 order 路径从当前
    // 列表检索构造（对 applyRepoOrder 两者等价，只提供顺序信息）。
    const reorder = (current: RepoInfo[]): RepoInfo[] => {
      const incoming =
        Array.isArray(res?.repos) && res.repos.length > 0
          ? res.repos
          : order.flatMap((p) => {
              const hit = current.find((r) => r.path === p);
              return hit ? [hit] : [];
            });
      return applyRepoOrder(current, incoming);
    };

    if (store === "panel") {
      usePanelStore.setState({ repos: reorder(usePanelStore.getState().repos) });
    } else {
      useCommitStore.setState({
        repos: reorder(useCommitStore.getState().repos),
      });
    }
  } catch (err) {
    console.error("setRepoOrder failed:", err);
  }
}

function PanelRepoSelector() {
  return (
    <RepoSelectorBody
      store="panel"
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
      store="commit"
      repos={useCommitStore((s) => s.repos)}
      currentRepoPath={useCommitStore((s) => s.currentRepoPath)}
      switchRepo={useCommitStore((s) => s.switchRepo)}
      repoStatuses={useCommitStore((s) => s.repoStatuses)}
      successFlash={useCommitStore((s) => s.successFlash)}
      orientation="vertical"
    />
  );
}

interface BodyProps {
  store: "panel" | "commit";
  repos: RepoInfo[];
  currentRepoPath: string | null;
  switchRepo: (path: string) => Promise<void>;
  /** Per-repo ahead/behind/dirty counts keyed by repo path (for chip badges). */
  repoStatuses: Record<string, RepoStatus>;
  /**
   * 推送成功后短暂打勾。命中当前仓库 chip（单仓库 strip 则是唯一 chip），
   * 用 ✓ 替换 ahead/behind（dirty 仍显示），约 3s 后恢复。仅 commit 面板启用。
   */
  successFlash?: boolean;
  /** Layout direction: "horizontal" for the bottom panel (wide), "vertical" for the sidebar (narrow). */
  orientation: "horizontal" | "vertical";
}

function RepoSelectorBody({
  store,
  repos,
  currentRepoPath,
  switchRepo,
  repoStatuses,
  successFlash,
  orientation,
}: BodyProps) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    repo: RepoInfo;
  } | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [overPath, setOverPath] = useState<string | null>(null);
  /**
   * Insertion side relative to the hovered chip. Pointer on the first half
   * (top in vertical / left in horizontal) = insert before; second half =
   * insert after — so dragging onto the bottom of the last vertical chip
   * draws the indicator BELOW it, not above.
   */
  const [dropSide, setDropSide] = useState<"before" | "after">("before");

  const openMenu = (e: React.MouseEvent, repo: RepoInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, repo });
  };

  const menuEl = menu && (
    <RepoContextMenu
      x={menu.x}
      y={menu.y}
      repo={menu.repo}
      repos={repos}
      orientation={orientation}
      onClose={() => setMenu(null)}
      onReorder={(order) => void persistRepoOrder(store, order)}
    />
  );

  // `from` 由调用方解析（内部拖拽用闭包 dragPath，外部拖入回退读
  // dataTransfer）——不能在内部读 dragPath：onDrop 里同步调用本函数时
  // setState 尚未生效，闭包值会是旧值。
  const handleDrop = (
    from: string | null,
    targetPath: string,
    side: "before" | "after",
  ) => {
    setDragPath(null);
    setOverPath(null);
    if (!from || from === targetPath) return;
    const paths = repos.map((r) => r.path);
    const fromIdx = paths.indexOf(from);
    const toIdx = paths.indexOf(targetPath);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    const next = [...paths];
    next.splice(fromIdx, 1);
    // After removing `fromIdx`, indices left of it shift down by 1.
    // "before target": insert at the (possibly shifted) target index.
    // "after target":  insert one slot past the (possibly shifted) target.
    const insertAt =
      side === "after"
        ? fromIdx < toIdx
          ? toIdx
          : toIdx + 1
        : fromIdx < toIdx
          ? toIdx - 1
          : toIdx;
    next.splice(insertAt, 0, from);
    void persistRepoOrder(store, next);
  };

  // No repos: nothing to render.
  if (repos.length === 0) return null;

  // Single-repo workspace: a read-only status strip.
  if (repos.length === 1) {
    const repo = repos[0];
    return (
      <div className={`repo-selector ${orientation} readonly`}>
        <div
          className="repo-chip"
          title={repo.path}
          onContextMenu={(e) => openMenu(e, repo)}
        >
          <RepoSelectedIcon width={14} height={14} />
          <span className="repo-name">{repo.name}</span>
          <RepoBranch status={repoStatuses[repo.path]} />
          <RepoBadges
            status={repoStatuses[repo.path]}
            flashSuccess={!!successFlash}
          />
        </div>
        {menuEl}
      </div>
    );
  }

  return (
    <div className={`repo-selector ${orientation}`}>
      {repos.map((repo) => {
        const isDragging = dragPath === repo.path;
        const isDropTarget =
          !!overPath &&
          overPath === repo.path &&
          !!dragPath &&
          dragPath !== repo.path;
        return (
          <button
            key={repo.path}
            type="button"
            className={[
              "repo-chip",
              repo.path === currentRepoPath ? "active" : "",
              isDragging ? "dragging" : "",
              isDropTarget
                ? dropSide === "after"
                  ? "drop-after"
                  : "drop-before"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={`${repo.path}\n${t("Drag to reorder")}`}
            draggable
            onClick={() => void switchRepo(repo.path)}
            onContextMenu={(e) => openMenu(e, repo)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", repo.path);
              setDragPath(repo.path);
              setDropSide("before");
            }}
            onDragEnd={() => {
              setDragPath(null);
              setOverPath(null);
            }}
            onDragOver={(e) => {
              if (!dragPath || dragPath === repo.path) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              const side =
                orientation === "vertical"
                  ? e.clientY < rect.top + rect.height / 2
                    ? "before"
                    : "after"
                  : e.clientX < rect.left + rect.width / 2
                    ? "before"
                    : "after";
              setOverPath(repo.path);
              setDropSide(side);
            }}
            onDragLeave={() => {
              if (overPath === repo.path) setOverPath(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              // 外部拖入（未经本组件 onDragStart）时 dragPath 为 null，回退
              // 读 dataTransfer；getData 无数据返回空串，用 || 归一为 null。
              // 非 repo path 的外部文本由 handleDrop 内 indexOf < 0 兜底早退。
              const from =
                dragPath || e.dataTransfer.getData("text/plain") || null;
              handleDrop(from, repo.path, dropSide);
            }}
          >
            {repo.path === currentRepoPath ? (
              <RepoSelectedIcon width={14} height={14} />
            ) : (
              <RepoIcon width={14} height={14} />
            )}
            <span className="repo-name">{repo.name}</span>
            <RepoBranch status={repoStatuses[repo.path]} />
            <RepoBadges
              status={repoStatuses[repo.path]}
              flashSuccess={!!successFlash && repo.path === currentRepoPath}
            />
          </button>
        );
      })}
      {menuEl}
    </div>
  );
}

/**
 * Current-branch label. Renders a git-branch glyph + branch name, sitting
 * between the repo name and the status badges.
 */
function RepoBranch({ status }: { status?: RepoStatus }) {
  const branch = status?.branch;
  if (!branch) return null;
  return (
    <span className="repo-branch" title={t("Branch: {0}", branch)}>
      <BranchIcon width={12} height={12} />
      <span className="branch-name">{branch}</span>
    </span>
  );
}

/**
 * ahead/behind/dirty badge cluster. Each badge renders only when its count is
 * truthy: `null` (no upstream / detached HEAD) hides ↑↓, and `0` hides any of
 * them. When all are zero/null the whole cluster is absent.
 */
function RepoBadges({
  status,
  flashSuccess,
}: {
  status?: RepoStatus;
  flashSuccess?: boolean;
}) {
  const { ahead, behind, dirty } = status ?? {};
  if (flashSuccess) {
    return (
      <span className="repo-badges">
        <span className="badge success-flash" title={t("Push succeeded")}>
          ✓
        </span>
        {dirty ? (
          <span className="badge dirty" title={t("{0} uncommitted files", dirty)}>
            ●{dirty}
          </span>
        ) : null}
      </span>
    );
  }
  if (!ahead && !behind && !dirty) return null;
  return (
    <span className="repo-badges">
      {ahead ? (
        <span className="badge ahead" title={t("Push {0} commits ahead", ahead)}>
          ↑{ahead}
        </span>
      ) : null}
      {behind ? (
        <span className="badge behind" title={t("Pull {0} commits behind", behind)}>
          ↓{behind}
        </span>
      ) : null}
      {dirty ? (
        <span className="badge dirty" title={t("{0} uncommitted files", dirty)}>
          ●{dirty}
        </span>
      ) : null}
    </span>
  );
}
