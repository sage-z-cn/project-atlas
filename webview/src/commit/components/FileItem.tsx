import { memo } from "react";
import type React from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { getCommitFileIcon } from "../utils/file-icon";

export interface FileItemProps {
  file: WorkingTreeFile;
  /** Directory-tree mode: display just this name (path already truncated by
   *  the tree). When omitted, derive the name + dir suffix from file.path. */
  fileNameOnly?: string;
  /** Stable parent callback (takes the row's own file) — no inline closures. */
  onContextMenu: (e: React.MouseEvent, file: WorkingTreeFile) => void;
}

/** Memoized JetBrains-style file row. selected/highlighted are subscribed
 *  per-row (boolean selectors) so selection/highlight changes only re-render
 *  the affected rows; every mutation resolves the latest store state via
 *  getState() so parents never pass per-row closures. */
export const FileItem = memo(function FileItem({
  file,
  fileNameOnly,
  onContextMenu,
}: FileItemProps) {
  const key = `${file.path}:${file.staged}`;
  const selected = useCommitStore((s) => s.selectedFiles.has(key));
  const highlighted = useCommitStore((s) => s.highlightedFiles.has(key));

  const parts = file.path.split("/");
  const derivedName = parts.pop() || parts.pop() || file.path;
  const dirPath =
    fileNameOnly == null && parts.length > 0 ? parts.join("/") : "";
  const fileName = fileNameOnly ?? derivedName;
  // Dir mode previously received a basename-truncated copy, so the tooltip
  // showed just the file name — keep that exact behavior.
  const titlePath = fileNameOnly ?? file.path;

  const statusLabel = getStatusLabel(file.status);
  const statusColor = getStatusColor(file.status);
  const FileIcon = getCommitFileIcon(file.path);

  return (
    <div
      className={`commit-file-item ${highlighted ? "highlighted" : ""}`}
      onDoubleClick={() => {
        useCommitStore.getState().showDiff(file);
      }}
      onClick={(e) => {
        const mode = e.metaKey || e.ctrlKey ? "toggle" : "single";
        useCommitStore.getState().highlightFile(`${file.path}:${file.staged}`, mode);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, file);
      }}
    >
      <input
        type="checkbox"
        className="commit-file-checkbox"
        checked={selected}
        onChange={() => {
          useCommitStore.getState().toggleFileSelection(`${file.path}:${file.staged}`);
        }}
      />
      <span className="commit-file-icon">
        <FileIcon style={{ width: 16, height: 16 }} />
      </span>
      <span
        className="commit-file-name"
        title={titlePath}
        style={{ color: statusColor }}
      >
        {fileName}
      </span>
      {dirPath && (
        <span className="commit-file-path" title={dirPath}>
          {dirPath}
        </span>
      )}
      <span className="commit-file-status" style={{ color: statusColor }}>
        {statusLabel}
      </span>
    </div>
  );
});

function getStatusLabel(status: WorkingTreeFile["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    case "conflicted":
      return "C";
    default:
      return "?";
  }
}

function getStatusColor(status: WorkingTreeFile["status"]): string {
  switch (status) {
    case "added":
      return "var(--vscode-gitDecoration-addedForeground, #6a8759)";
    case "untracked":
      return "var(--vscode-gitDecoration-untrackedForeground, #d1675a)";
    case "modified":
      return "var(--vscode-gitDecoration-modifiedForeground, #6897bb)";
    case "deleted":
      return "var(--vscode-gitDecoration-deletedForeground, #6c6c6c)";
    case "renamed":
      return "var(--vscode-gitDecoration-renamedForeground, #b9b462)";
    case "conflicted":
      return "var(--vscode-gitDecoration-conflictingResourceForeground, #d1675a)";
    default:
      return "inherit";
  }
}
