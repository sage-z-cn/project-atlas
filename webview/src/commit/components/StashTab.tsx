import { useCallback, useEffect, useState } from "react";
import {
  type StashEntry,
  useCommitStore,
} from "../../shared/store/commit-store";
import { t } from "../../shared/i18n";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { getCommitFileIcon } from "../utils/file-icon";
import { StashContextMenu } from "./StashContextMenu";
import { StashFileContextMenu } from "./StashFileContextMenu";
import { DeleteStashesModal } from "./DeleteStashesModal";
import TrashIcon from "~icons/codicon/trash";

export function StashTab() {
  const { stashes, fetchStashes, stashLoading } = useCommitStore();
  // 展开状态以 sha 为索引（stash@{n} 的 id 在任何删除/恢复后会重排，
  // 作为 key/索引会把展开态串到错误条目上）。
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  /** 多选删除的目标条目（完整 SHA）。列表刷新后按存活 sha 剪枝。 */
  const [selectedShas, setSelectedShas] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: StashEntry;
    /** >1 时右键菜单进入批量模式（仅「删除 N 项」）。 */
    batchCount: number;
  } | null>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
    stashRef: string;
  } | null>(null);
  /** 批量删除确认弹窗；null = 关闭。 */
  const [confirmShas, setConfirmShas] = useState<string[] | null>(null);

  // 弹窗展示的条目 = confirmShas 按当前存活 stash 剪枝
  // （弹窗存续期间 stash 栈可能被外部改动，如另一窗口的 git 操作）。
  const confirmEntries = confirmShas
    ? confirmShas
        .map((sha) => stashes.find((s) => s.sha === sha))
        .filter((e): e is StashEntry => Boolean(e))
    : [];

  useEffect(() => {
    fetchStashes();
  }, [fetchStashes]);

  // 列表刷新（含 repo 切换清空）后剪掉已不存在的选中项。
  useEffect(() => {
    setSelectedShas((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(stashes.map((s) => s.sha));
      const next = new Set([...prev].filter((sha) => alive.has(sha)));
      return next.size === prev.size ? prev : next;
    });
  }, [stashes]);

  // 弹窗目标已全部消失 → 弹窗不渲染且 confirmShas 无法退出
  // （Esc 清选 handler 也被其脱钩），直接关闭弹窗状态。
  useEffect(() => {
    if (confirmShas && confirmEntries.length === 0) {
      setConfirmShas(null);
    }
  }, [confirmShas, confirmEntries]);

  // Esc：无菜单/弹窗时清空选择（菜单组件自行处理 Esc 关闭）。
  useEffect(() => {
    if (contextMenu || fileContextMenu || confirmShas) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedShas(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contextMenu, fileContextMenu, confirmShas]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelect = useCallback((sha: string) => {
    setSelectedShas((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) next.delete(sha);
      else next.add(sha);
      return next;
    });
  }, []);

  const allSelected = stashes.length > 0 && selectedShas.size === stashes.length;
  const someSelected = selectedShas.size > 0 && !allSelected;

  const handleSelectAll = useCallback(() => {
    setSelectedShas((prev) => {
      if (stashes.length > 0 && prev.size === stashes.length) {
        return new Set();
      }
      return new Set(stashes.map((s) => s.sha));
    });
  }, [stashes]);

  const openDeleteConfirm = useCallback((shas: string[]) => {
    if (shas.length === 0) return;
    setConfirmShas(shas);
  }, []);

  const handleToolbarDelete = useCallback(() => {
    openDeleteConfirm([...selectedShas]);
  }, [selectedShas, openDeleteConfirm]);

  const handleConfirmDelete = useCallback(() => {
    // 发送用户实际确认的存活集合（弹窗展示的条目），而非打开弹窗时的原始快照：
    // 死 SHA 会让 host 端整批请求 reject，且已执行部分不回滚。
    const target = confirmEntries.map((e) => e.sha);
    setConfirmShas(null);
    setSelectedShas(new Set());
    if (target.length > 0) {
      void useCommitStore.getState().deleteStashes(target);
    }
  }, [confirmEntries]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: StashEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setFileContextMenu(null);
      // 右键已选中且存在多选 → 批量菜单；否则单选该条并走单条菜单。
      const isBatch = selectedShas.has(entry.sha) && selectedShas.size > 1;
      if (!isBatch) {
        setSelectedShas(new Set([entry.sha]));
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        entry,
        batchCount: isBatch ? selectedShas.size : 1,
      });
    },
    [selectedShas],
  );

  const handleFileContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string, stashRef: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu(null);
      setFileContextMenu({ x: e.clientX, y: e.clientY, filePath, stashRef });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const closeFileContextMenu = useCallback(() => {
    setFileContextMenu(null);
  }, []);

  return (
    <div className="stash-tab">
      {/* 顶部操作栏：对齐 commit-toolbar 视觉；全选 checkbox 与行内
          checkbox 同左缩进，删除按钮无数量文案、未勾选时禁用。 */}
      <div className="commit-toolbar stash-toolbar">
        <input
          type="checkbox"
          className="stash-select-all"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          disabled={stashes.length === 0 || stashLoading}
          onChange={handleSelectAll}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("Select All")}
        />
        <span className="stash-select-all-label">{t("Select All")}</span>
        <div className="commit-toolbar-spacer" />
        <Tooltip text={t("Delete")}>
          <button
            type="button"
            className="commit-toolbar-btn"
            disabled={selectedShas.size === 0 || stashLoading}
            onClick={handleToolbarDelete}
            aria-label={t("Delete")}
          >
            <TrashIcon />
          </button>
        </Tooltip>
      </div>

      {/* stash 操作（unstash/delete/unstashFile）进行中禁用交互并视觉置灰，
          防止在乐观移除 + refetch 的窗口期对重排后的条目误操作。 */}
      <div
        className="stash-list"
        style={
          stashLoading ? { pointerEvents: "none", opacity: 0.5 } : undefined
        }
      >
        {stashes.length === 0 ? (
          <div className="stash-empty">
            <p>{t("No stashed changes")}</p>
            <p style={{ fontSize: 11, marginTop: 8 }}>
              {t(
                "Right-click changed files in the Commit tab to stash changes for later.",
              )}
            </p>
          </div>
        ) : (
          stashes.map((entry) => (
            <StashItem
              key={entry.sha}
              entry={entry}
              expanded={expandedIds.has(entry.sha)}
              selected={selectedShas.has(entry.sha)}
              onToggle={() => toggleExpand(entry.sha)}
              onToggleSelect={() => toggleSelect(entry.sha)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
              onFileContextMenu={handleFileContextMenu}
            />
          ))
        )}
        {contextMenu && (
          <StashContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            entry={contextMenu.entry}
            batchCount={contextMenu.batchCount}
            onDeleteBatch={() => {
              openDeleteConfirm([...selectedShas]);
            }}
            onClose={closeContextMenu}
          />
        )}
        {fileContextMenu && (
          <StashFileContextMenu
            x={fileContextMenu.x}
            y={fileContextMenu.y}
            filePath={fileContextMenu.filePath}
            stashRef={fileContextMenu.stashRef}
            onClose={closeFileContextMenu}
          />
        )}
      </div>

      {confirmShas && confirmEntries.length > 0 && (
        <DeleteStashesModal
          entries={confirmEntries}
          onCancel={() => setConfirmShas(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

interface StashItemProps {
  entry: StashEntry;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onToggleSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onFileContextMenu: (
    e: React.MouseEvent,
    filePath: string,
    stashRef: string,
  ) => void;
}

function StashItem({
  entry,
  expanded,
  selected,
  onToggle,
  onToggleSelect,
  onContextMenu,
  onFileContextMenu,
}: StashItemProps) {
  const dateStr = formatDate(entry.date);

  return (
    <div className="stash-item-container" onContextMenu={onContextMenu}>
      <div
        className={`stash-item-row${selected ? " selected" : ""}`}
        onClick={onToggle}
      >
        <input
          type="checkbox"
          className="stash-item-checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={entry.message || t("Changes")}
        />
        <span className="stash-item-title">{entry.message || t("Changes")}</span>
        <span className="stash-item-info">
          {t("{0} file(s)", entry.files.length)},{" "}
          {dateStr}
        </span>
        <span className={`stash-item-chevron ${expanded ? "" : "collapsed"}`}>
          <ChevronIcon />
        </span>
      </div>

      {expanded && entry.files.length > 0 && (
        <div className="stash-item-file-list">
          {entry.files.map((filePath) => (
            <StashFileRow
              key={filePath}
              filePath={filePath}
              onContextMenu={(e) => onFileContextMenu(e, filePath, entry.sha)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StashFileRow({
  filePath,
  onContextMenu,
}: {
  filePath: string;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const parts = filePath.split("/");
  const fileName = parts.pop() || filePath;
  const dirPath = parts.length > 0 ? parts.join("/") : "";
  const FileIcon = getCommitFileIcon(filePath);

  return (
    <div
      className="stash-file-row"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
    >
      <span className="stash-file-icon">
        <FileIcon style={{ width: 16, height: 16 }} />
      </span>
      <span className="stash-file-name">{fileName}</span>
      {dirPath && <span className="stash-file-path">{dirPath}</span>}
    </div>
  );
}

function formatDate(isoDate: string): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffHr / 24);

  if (diffHr < 1) return t("just now");
  if (diffHr < 24) return t("{0}h ago", diffHr);
  if (diffDay < 7) return t("{0}d ago", diffDay);

  // 与 CommitRow / CommitInfo 同口径：yyyy-MM-dd HH:mm
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 11.5L9.5 8L6 4.5"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  );
}
