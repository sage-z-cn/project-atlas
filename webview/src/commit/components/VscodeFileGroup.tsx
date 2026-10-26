import { memo } from "react";
import type React from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { collectDirFiles, type DirNode } from "../utils/dirTree";
import type { VscodeGroupType } from "./VscodeFileItem";
import ChevronIcon from "~icons/codicon/chevron-right";
import FolderIcon from "~icons/codicon/folder";
import AddIcon from "~icons/codicon/add";
import RemoveIcon from "~icons/codicon/remove";
import DiscardIcon from "~icons/codicon/discard";

/**
 * Row components for the virtualized vscode-style change list.
 *
 * VscodeCommitList flattens group headers, directory rows and file rows into
 * one row array and renders them through a single useVirtualizer; these are
 * the memoized row renderers. All store mutations resolve via getState() or
 * stable action selectors so no per-row closures are ever passed down.
 */

/** One top-level file group in the vscode-style list (flattened row model). */
export interface VscodeGroupSpec {
  /** expandedGroups / collapsedDirs scope id (merge normalizes to "conflicts"). */
  id: "conflicts" | "staged" | "changes";
  type: VscodeGroupType;
  label: string;
  files: WorkingTreeFile[];
}

export const VscodeGroupHeaderRow = memo(function VscodeGroupHeaderRow({
  group,
  expanded,
  onGroupContextMenu,
}: {
  group: VscodeGroupSpec;
  expanded: boolean;
  onGroupContextMenu: (
    e: React.MouseEvent,
    files: WorkingTreeFile[],
    groupType: VscodeGroupType,
  ) => void;
}) {
  const toggleGroup = useCommitStore((s) => s.toggleGroup);
  const unstageAll = useCommitStore((s) => s.unstageAll);
  const stageAll = useCommitStore((s) => s.stageAll);
  const requestRollbackFiles = useCommitStore((s) => s.requestRollbackFiles);
  const { type: groupType, label, files, id } = group;

  return (
    <div
      className="vscode-scm-group-header"
      onClick={() => toggleGroup(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onGroupContextMenu(e, files, groupType);
      }}
    >
      <span className={`vscode-scm-chevron ${expanded ? "" : "collapsed"}`}>
        <ChevronIcon />
      </span>
      <span className="vscode-scm-group-label">{label}</span>
      <span className="vscode-scm-group-tail">
      <span className="vscode-scm-group-actions">
        {groupType === "merge" && (
          <button
            type="button"
            className="vscode-scm-group-action-btn"
            title={t("Resolve Conflicts")}
            onClick={(e) => {
              e.stopPropagation();
              bridge.request("openConflictsPanel");
            }}
          >
            {t("Resolve")}
          </button>
        )}
        {groupType === "staged" && (
          <button
            type="button"
            className="vscode-file-action-btn"
            title={t("Unstage All Changes")}
            onClick={(e) => {
              e.stopPropagation();
              void unstageAll();
            }}
          >
            <RemoveIcon />
          </button>
        )}
        {groupType === "changes" && (
          <>
            <button
              type="button"
              className="vscode-file-action-btn"
              title={t("Discard All Changes...")}
              onClick={(e) => {
                e.stopPropagation();
                // webview 内确认弹窗（store 驱动），确认后 confirmed:true。
                void requestRollbackFiles(
                  files.map((f) => ({ path: f.path, staged: f.staged })),
                );
              }}
            >
              <DiscardIcon />
            </button>
            <button
              type="button"
              className="vscode-file-action-btn"
              title={t("Stage All Changes")}
              onClick={(e) => {
                e.stopPropagation();
                void stageAll();
              }}
            >
              <AddIcon />
            </button>
          </>
        )}
      </span>
      <span className="vscode-scm-group-count">{files.length}</span>
      </span>
    </div>
  );
});

export const VscodeDirRow = memo(function VscodeDirRow({
  node,
  depth,
  groupType,
  groupId,
  collapsed,
  onDirContextMenu,
}: {
  node: DirNode;
  depth: number;
  groupType: VscodeGroupType;
  groupId: VscodeGroupSpec["id"];
  collapsed: boolean;
  onDirContextMenu: (
    e: React.MouseEvent,
    files: WorkingTreeFile[],
    groupType: VscodeGroupType,
    fullPath?: string,
  ) => void;
}) {
  const toggleDir = useCommitStore((s) => s.toggleDir);
  const stageFiles = useCommitStore((s) => s.stageFiles);
  const unstageFiles = useCommitStore((s) => s.unstageFiles);
  const requestRollbackFiles = useCommitStore((s) => s.requestRollbackFiles);

  return (
    <div
      className="vscode-dir-row"
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onClick={() => toggleDir(groupId, node.fullPath)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDirContextMenu(e, collectDirFiles(node), groupType, node.fullPath);
      }}
    >
      <span
        className={`vscode-scm-chevron ${collapsed ? "collapsed" : ""}`}
      >
        <ChevronIcon />
      </span>
      <FolderIcon className="vscode-dir-folder-icon" />
      <span className="vscode-dir-name">{node.name}</span>
      <span className="vscode-dir-tail">
      <span className="vscode-dir-actions">
        {groupType === "changes" && (
          <>
            <button
              type="button"
              className="vscode-file-action-btn"
              title={t("Discard All Changes...")}
              onClick={(e) => {
                e.stopPropagation();
                // webview 内确认弹窗（store 驱动），确认后 confirmed:true。
                void requestRollbackFiles(
                  collectDirFiles(node).map((f) => ({
                    path: f.path,
                    staged: f.staged,
                  })),
                );
              }}
            >
              <DiscardIcon />
            </button>
            <button
              type="button"
              className="vscode-file-action-btn"
              title={t("Stage All Changes")}
              onClick={(e) => {
                e.stopPropagation();
                void stageFiles(
                  collectDirFiles(node).map((f) => f.path),
                );
              }}
            >
              <AddIcon />
            </button>
          </>
        )}
        {groupType === "staged" && (
          <button
            type="button"
            className="vscode-file-action-btn"
            title={t("Unstage All Changes")}
            onClick={(e) => {
              e.stopPropagation();
              void unstageFiles(
                collectDirFiles(node).map((f) => f.path),
              );
            }}
          >
            <RemoveIcon />
          </button>
        )}
        {/* merge group: no batch buttons (conflicts handled individually) */}
      </span>
      <span className="vscode-dir-count">
        {t("{0} file(s)", node.fileCount)}
      </span>
      </span>
    </div>
  );
});
