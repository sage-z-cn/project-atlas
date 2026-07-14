import { useMemo } from "react";
import type React from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import {
  buildDirTree,
  collectDirFiles,
  countFiles,
  type DirNode,
} from "../utils/dirTree";
import { VscodeFileItem, type VscodeGroupType } from "./VscodeFileItem";
import ChevronIcon from "~icons/codicon/chevron-right";
import FolderIcon from "~icons/codicon/folder";
import AddIcon from "~icons/codicon/add";
import RemoveIcon from "~icons/codicon/remove";
import DiscardIcon from "~icons/codicon/discard";

export interface VscodeFileGroupProps {
  groupType: VscodeGroupType;
  label: string;
  files: WorkingTreeFile[];
  expanded: boolean;
  groupByDirectory: boolean;
  highlightedFiles: Set<string>;
  onToggle: () => void;
  onContextMenu: (
    e: React.MouseEvent,
    file: WorkingTreeFile,
  ) => void;
  onGroupContextMenu: (
    e: React.MouseEvent,
    files: WorkingTreeFile[],
    groupType: VscodeGroupType,
  ) => void;
  onDirContextMenu: (
    e: React.MouseEvent,
    files: WorkingTreeFile[],
    groupType: VscodeGroupType,
  ) => void;
}

export function VscodeFileGroup({
  groupType,
  label,
  files,
  expanded,
  groupByDirectory,
  highlightedFiles,
  onToggle,
  onContextMenu,
  onGroupContextMenu,
  onDirContextMenu,
}: VscodeFileGroupProps) {
  const { collapsedDirs, toggleDir, unstageAll, stageAll, rollbackFiles } =
    useCommitStore();

  const tree = useMemo(
    () => (groupByDirectory ? buildDirTree(files) : null),
    [files, groupByDirectory],
  );

  return (
    <div className="vscode-scm-group">
      <div
        className="vscode-scm-group-header"
        onClick={onToggle}
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
                  // Backend rollbackFiles handler opens a modal confirmation.
                  void rollbackFiles(files.map((f) => f.path));
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
      </div>
      {expanded && (
        <div className="vscode-scm-group-files">
          {groupByDirectory && tree ? (
            <VscodeDirNodeView
              node={tree}
              depth={0}
              groupType={groupType}
              collapsed={collapsedDirs}
              toggleDir={toggleDir}
              highlightedFiles={highlightedFiles}
              onContextMenu={onContextMenu}
              onDirContextMenu={onDirContextMenu}
            />
          ) : (
            files.map((file) => {
              const key = `${file.path}:${file.staged}`;
              return (
                <VscodeFileItem
                  key={key}
                  file={file}
                  groupType={groupType}
                  highlighted={highlightedFiles.has(key)}
                  onContextMenu={(e) => onContextMenu(e, file)}
                  onShowDiff={() =>
                    useCommitStore.getState().showDiff(file.path, file.staged)
                  }
                  onClick={(e) => {
                    const mode =
                      e.metaKey || e.ctrlKey ? "toggle" : "single";
                    useCommitStore
                      .getState()
                      .highlightFile(key, mode);
                  }}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function VscodeDirNodeView({
  node,
  depth,
  groupType,
  collapsed,
  toggleDir,
  highlightedFiles,
  onContextMenu,
  onDirContextMenu,
}: {
  node: DirNode;
  depth: number;
  groupType: VscodeGroupType;
  collapsed: Set<string>;
  toggleDir: (path: string) => void;
  highlightedFiles: Set<string>;
  onContextMenu: (
    e: React.MouseEvent,
    file: WorkingTreeFile,
  ) => void;
  onDirContextMenu: (
    e: React.MouseEvent,
    files: WorkingTreeFile[],
    groupType: VscodeGroupType,
  ) => void;
}) {
  const { stageFiles, unstageFiles, rollbackFiles } = useCommitStore();
  return (
    <>
      {/* Subdirectories */}
      {node.children
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => {
          const isCollapsed = collapsed.has(child.fullPath);
          return (
            <div key={child.fullPath}>
              <div
                className="vscode-dir-row"
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                onClick={() => toggleDir(child.fullPath)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDirContextMenu(e, collectDirFiles(child), groupType);
                }}
              >
                <span
                  className={`vscode-scm-chevron ${isCollapsed ? "collapsed" : ""}`}
                >
                  <ChevronIcon />
                </span>
                <FolderIcon className="vscode-dir-folder-icon" />
                <span className="vscode-dir-name">{child.name}</span>
                <span className="vscode-dir-actions">
                  {groupType === "changes" && (
                    <>
                      <button
                        type="button"
                        className="vscode-file-action-btn"
                        title={t("Discard All Changes...")}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Backend rollbackFiles handler opens a modal confirmation.
                          void rollbackFiles(
                            collectDirFiles(child).map((f) => f.path),
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
                            collectDirFiles(child).map((f) => f.path),
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
                          collectDirFiles(child).map((f) => f.path),
                        );
                      }}
                    >
                      <RemoveIcon />
                    </button>
                  )}
                  {/* merge group: no batch buttons (conflicts handled individually) */}
                </span>
                <span className="vscode-dir-count">
                  {t("{0} file(s)", countFiles(child))}
                </span>
              </div>
              {!isCollapsed && (
                <VscodeDirNodeView
                  node={child}
                  depth={depth + 1}
                  groupType={groupType}
                  collapsed={collapsed}
                  toggleDir={toggleDir}
                  highlightedFiles={highlightedFiles}
                  onContextMenu={onContextMenu}
                  onDirContextMenu={onDirContextMenu}
                />
              )}
            </div>
          );
        })}
      {/* Files in this directory */}
      {node.files.map((file) => {
        const key = `${file.path}:${file.staged}`;
        const fileName = file.path.split("/").pop() || file.path;
        return (
          <div key={key} style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
            <VscodeFileItem
              file={file}
              fileNameOnly={fileName}
              groupType={groupType}
              highlighted={highlightedFiles.has(key)}
              onContextMenu={(e) => onContextMenu(e, file)}
              onShowDiff={() =>
                useCommitStore.getState().showDiff(file.path, file.staged)
              }
              onClick={(e) => {
                const mode = e.metaKey || e.ctrlKey ? "toggle" : "single";
                useCommitStore.getState().highlightFile(key, mode);
              }}
            />
          </div>
        );
      })}
    </>
  );
}
