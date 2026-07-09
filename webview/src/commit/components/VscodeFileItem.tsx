import type React from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { getCommitFileIcon } from "../utils/file-icon";
import GoToFileIcon from "~icons/codicon/go-to-file";
import AddIcon from "~icons/codicon/add";
import RemoveIcon from "~icons/codicon/remove";
import DiscardIcon from "~icons/codicon/discard";
import DiffIcon from "~icons/codicon/git-compare";

export type VscodeGroupType = "merge" | "staged" | "changes";

export interface VscodeFileItemProps {
  file: WorkingTreeFile;
  /** When set (directory-tree mode), display just this name (path already
   * truncated by the tree). When omitted (flat mode), derive from file.path. */
  fileNameOnly?: string;
  /** Optional directory path suffix to render after the file name (flat mode). */
  dirPath?: string;
  groupType: VscodeGroupType;
  highlighted: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onShowDiff: () => void;
  onClick: (e: React.MouseEvent) => void;
}

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

function getStatusClass(status: WorkingTreeFile["status"]): string {
  switch (status) {
    case "added":
      return "status-added";
    case "modified":
      return "status-modified";
    case "deleted":
      return "status-deleted";
    case "renamed":
      return "status-renamed";
    case "untracked":
      return "status-untracked";
    case "conflicted":
      return "status-conflicted";
    default:
      return "status-untracked";
  }
}

export function VscodeFileItem({
  file,
  fileNameOnly,
  dirPath,
  groupType,
  highlighted,
  onContextMenu,
  onShowDiff,
  onClick,
}: VscodeFileItemProps) {
  const FileIcon = getCommitFileIcon(file.path);

  // Derive display name + dir suffix for flat mode.
  const parts = file.path.split("/");
  const derivedName = parts.pop() || file.path;
  const derivedDir = parts.length > 0 ? parts.join("/") : "";
  const displayName = fileNameOnly ?? derivedName;
  const displayDir = fileNameOnly != null ? (dirPath ?? "") : derivedDir;

  const statusLabel = getStatusLabel(file.status);
  const statusClass = getStatusClass(file.status);

  return (
    <div
      className={`vscode-file-item ${highlighted ? "highlighted" : ""}`}
      title={file.path}
      onDoubleClick={onShowDiff}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
    >
      <span className="vscode-file-icon">
        <FileIcon style={{ width: 16, height: 16 }} />
      </span>
      <span className={`vscode-file-name ${statusClass}`}>{displayName}</span>
      {displayDir && (
        <span className="vscode-file-path" title={displayDir}>
          {displayDir}
        </span>
      )}
      <span className="vscode-file-actions">
        {/* Open file (all groups) */}
        <button
          type="button"
          className="vscode-file-action-btn"
          title={t("Open File")}
          onClick={(e) => {
            e.stopPropagation();
            bridge.request("openFile", { filePath: file.path });
          }}
        >
          <GoToFileIcon />
        </button>

        {/* Open diff (merge only) */}
        {groupType === "merge" && (
          <button
            type="button"
            className="vscode-file-action-btn"
            title={t("Open Changes")}
            onClick={(e) => {
              e.stopPropagation();
              useCommitStore.getState().showDiff(file.path, file.staged);
            }}
          >
            <DiffIcon />
          </button>
        )}

        {/* Discard (changes only) — before Stage per VSCode-style ordering:
            Open File → Discard → Stage */}
        {groupType === "changes" && (
          <button
            type="button"
            className="vscode-file-action-btn"
            title={t("Discard Changes")}
            onClick={(e) => {
              e.stopPropagation();
              // Backend handler opens a modal confirmation — no client confirm.
              useCommitStore.getState().rollbackFile(file.path);
            }}
          >
            <DiscardIcon />
          </button>
        )}

        {/* Stage (changes) / Unstage (staged) */}
        {(groupType === "changes" || groupType === "staged") && (
          <button
            type="button"
            className="vscode-file-action-btn"
            title={
              groupType === "staged"
                ? t("Unstage Changes")
                : t("Stage Changes")
            }
            onClick={(e) => {
              e.stopPropagation();
              const store = useCommitStore.getState();
              if (groupType === "staged") {
                store.unstageFile(file.path);
              } else {
                store.stageFile(file.path);
              }
            }}
          >
            {groupType === "staged" ? <RemoveIcon /> : <AddIcon />}
          </button>
        )}
      </span>
      <span className={`vscode-file-status ${statusClass}`}>
        {statusLabel}
      </span>
    </div>
  );
}
