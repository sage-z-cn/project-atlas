import { useCallback, useEffect, useState } from "react";
import {
  type StashEntry,
  useCommitStore,
} from "../../shared/store/commit-store";
import { t } from "../../shared/i18n";
import { getCommitFileIcon } from "../utils/file-icon";
import { StashContextMenu } from "./StashContextMenu";
import { StashFileContextMenu } from "./StashFileContextMenu";

export function StashTab() {
  const { stashes, fetchStashes, stashLoading } = useCommitStore();
  // 展开状态以 sha 为索引（stash@{n} 的 id 在任何删除/恢复后会重排，
  // 作为 key/索引会把展开态串到错误条目上）。
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: StashEntry;
  } | null>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
    stashRef: string;
  } | null>(null);

  useEffect(() => {
    fetchStashes();
  }, [fetchStashes]);

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: StashEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setFileContextMenu(null);
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [],
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

  if (stashes.length === 0) {
    return (
      <div className="stash-list">
        <div className="stash-empty">
          <p>{t("No stashed changes")}</p>
          <p style={{ fontSize: 11, marginTop: 8 }}>
            {t(
              "Right-click changed files in the Commit tab to stash changes for later.",
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    // stash 操作（unstash/delete/unstashFile）进行中禁用交互并视觉置灰，
    // 防止在乐观移除 + refetch 的窗口期对重排后的条目误操作。
    <div
      className="stash-list"
      style={
        stashLoading ? { pointerEvents: "none", opacity: 0.5 } : undefined
      }
    >
      {stashes.map((entry) => (
        <StashItem
          key={entry.sha}
          entry={entry}
          expanded={expandedIds.has(entry.sha)}
          onToggle={() => toggleExpand(entry.sha)}
          onContextMenu={(e) => handleContextMenu(e, entry)}
          onFileContextMenu={handleFileContextMenu}
        />
      ))}
      {contextMenu && (
        <StashContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
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
  );
}

interface StashItemProps {
  entry: StashEntry;
  expanded: boolean;
  onToggle: () => void;
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
  onToggle,
  onContextMenu,
  onFileContextMenu,
}: StashItemProps) {
  const dateStr = formatDate(entry.date);

  return (
    <div className="stash-item-container" onContextMenu={onContextMenu}>
      <div className="stash-item-row" onClick={onToggle}>
        <span className={`stash-item-chevron ${expanded ? "" : "collapsed"}`}>
          <ChevronIcon />
        </span>
        <span className="stash-item-title">{entry.message || t("Changes")}</span>
        <span className="stash-item-info">
          {t("{0} file(s)", entry.files.length)},{" "}
          {dateStr}
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
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffHr / 24);

  if (diffHr < 1) return t("just now");
  if (diffHr < 24) return t("{0}h ago", diffHr);
  if (diffDay < 7) return t("{0}d ago", diffDay);

  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear() % 100;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${d}/${m}/${y} ${hh}:${mm}`;
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
