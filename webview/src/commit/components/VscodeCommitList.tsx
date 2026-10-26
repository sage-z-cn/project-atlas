import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useState } from "react";
import type React from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { t } from "../../shared/i18n";
import { buildDirTree, dirCollapseKey, type DirNode } from "../utils/dirTree";
import { VscodeFileItem, type VscodeGroupType } from "./VscodeFileItem";
import {
  VscodeDirRow,
  VscodeGroupHeaderRow,
  type VscodeGroupSpec,
} from "./VscodeFileGroup";
import { VscodeFileContextMenu } from "./VscodeFileContextMenu";
import { VscodeBatchContextMenu } from "./VscodeBatchContextMenu";

interface VscodeContextMenuState {
  x: number;
  y: number;
  file: WorkingTreeFile;
}

interface VscodeBatchMenuState {
  x: number;
  y: number;
  files: WorkingTreeFile[];
  groupType: VscodeGroupType;
  fullPath?: string;
}

/**
 * Flattened row model: the three groups (conflicted / staged / unstaged),
 * their headers, directory rows and file rows are flattened into a single
 * array so ONE virtualizer renders the whole list — 7000+ files no longer
 * mount 30k DOM nodes.
 */
type VscodeRow =
  | {
      kind: "groupHeader";
      key: string;
      group: VscodeGroupSpec;
      expanded: boolean;
    }
  | {
      kind: "dir";
      key: string;
      groupId: VscodeGroupSpec["id"];
      groupType: VscodeGroupType;
      node: DirNode;
      depth: number;
      collapsed: boolean;
    }
  | {
      kind: "file";
      key: string;
      groupType: VscodeGroupType;
      file: WorkingTreeFile;
      /** Directory depth in tree mode; -1 in flat mode. */
      depth: number;
      treeMode: boolean;
    };

/** Every vscode row (group header / dir row / file row) is min-height 24px
 *  (single-line, border-box). estimateSize starts at 24 and measureElement
 *  corrects for any drift (font size / zoom overrides). */
const ROW_HEIGHT = 24;

export function VscodeCommitList({
  scrollRef,
}: {
  /** Scroll container (.commit-file-list), owned and rendered by CommitTab so
   *  the DOM structure and scrollbar behavior stay exactly as before. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Field-level subscriptions: typing in the commit box, highlight changes,
  // loading flips etc. must not re-render this list.
  const changes = useCommitStore((s) => s.changes);
  const expandedGroups = useCommitStore((s) => s.expandedGroups);
  const groupByDirectory = useCommitStore((s) => s.groupByDirectory);
  const collapsedDirs = useCommitStore((s) => s.collapsedDirs);

  const [contextMenu, setContextMenu] = useState<VscodeContextMenuState | null>(
    null,
  );
  const [batchMenu, setBatchMenu] = useState<VscodeBatchMenuState | null>(null);

  // VSCode-style grouping (untracked folded into Changes):
  //   Merge Changes (conflicted) -> Staged Changes -> Changes (rest, incl untracked)
  const groups = useMemo<VscodeGroupSpec[]>(() => {
    const cf: WorkingTreeFile[] = [];
    const st: WorkingTreeFile[] = [];
    const un: WorkingTreeFile[] = [];
    for (const f of changes) {
      if (f.status === "conflicted") {
        cf.push(f);
      } else if (f.staged) {
        st.push(f);
      } else {
        un.push(f); // includes untracked
      }
    }
    const result: VscodeGroupSpec[] = [];
    if (cf.length > 0) {
      result.push({
        id: "conflicts",
        type: "merge",
        label: t("Merge Changes"),
        files: cf,
      });
    }
    if (st.length > 0) {
      result.push({
        id: "staged",
        type: "staged",
        label: t("Staged Changes"),
        files: st,
      });
    }
    if (un.length > 0) {
      result.push({
        id: "changes",
        type: "changes",
        label: t("Changes"),
        files: un,
      });
    }
    return result;
  }, [changes]);

  // Trees are only rebuilt when the underlying files (or grouping mode)
  // change — expand/collapse just re-flattens rows below.
  const trees = useMemo(
    () => (groupByDirectory ? groups.map((g) => buildDirTree(g.files)) : null),
    [groups, groupByDirectory],
  );

  // Flatten headers + dir rows + file rows, honoring group expansion and
  // per-directory collapse. Children are pre-sorted by buildDirTree; files of
  // a directory render after its subdirectories (previous render order).
  const rows = useMemo<VscodeRow[]>(() => {
    const out: VscodeRow[] = [];
    groups.forEach((group, gi) => {
      const expanded = expandedGroups.has(group.id);
      out.push({
        kind: "groupHeader",
        key: `group:${group.id}`,
        group,
        expanded,
      });
      if (!expanded) return;

      if (groupByDirectory && trees) {
        const walk = (node: DirNode, depth: number) => {
          for (const child of node.children) {
            const collapsed = collapsedDirs.has(
              dirCollapseKey(group.id, child.fullPath),
            );
            out.push({
              kind: "dir",
              key: `dir:${group.id}:${child.fullPath}`,
              groupId: group.id,
              groupType: group.type,
              node: child,
              depth,
              collapsed,
            });
            if (!collapsed) {
              walk(child, depth + 1);
            }
          }
          for (const file of node.files) {
            out.push({
              kind: "file",
              key: `${file.path}:${file.staged}`,
              groupType: group.type,
              file,
              depth,
              treeMode: true,
            });
          }
        };
        walk(trees[gi], 0);
      } else {
        for (const file of group.files) {
          out.push({
            kind: "file",
            key: `${file.path}:${file.staged}`,
            groupType: group.type,
            file,
            depth: -1,
            treeMode: false,
          });
        }
      }
    });
    return out;
  }, [groups, trees, groupByDirectory, expandedGroups, collapsedDirs]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    getItemKey: (index) => rows[index].key,
  });

  // Stable callbacks — memoized rows never receive inline closures.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: WorkingTreeFile) => {
      setContextMenu({ x: e.clientX, y: e.clientY, file });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleGroupContextMenu = useCallback(
    (
      e: React.MouseEvent,
      files: WorkingTreeFile[],
      groupType: VscodeGroupType,
    ) => {
      setBatchMenu({ x: e.clientX, y: e.clientY, files, groupType });
    },
    [],
  );

  const handleDirContextMenu = useCallback(
    (
      e: React.MouseEvent,
      files: WorkingTreeFile[],
      groupType: VscodeGroupType,
      fullPath?: string,
    ) => {
      setBatchMenu({ x: e.clientX, y: e.clientY, files, groupType, fullPath });
    },
    [],
  );

  const closeBatchMenu = useCallback(() => setBatchMenu(null), []);

  return (
    <>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.kind === "groupHeader" ? (
                <VscodeGroupHeaderRow
                  group={row.group}
                  expanded={row.expanded}
                  onGroupContextMenu={handleGroupContextMenu}
                />
              ) : row.kind === "dir" ? (
                <VscodeDirRow
                  node={row.node}
                  depth={row.depth}
                  groupType={row.groupType}
                  groupId={row.groupId}
                  collapsed={row.collapsed}
                  onDirContextMenu={handleDirContextMenu}
                />
              ) : row.treeMode ? (
                <div style={{ paddingLeft: `${(row.depth + 1) * 16}px` }}>
                  <VscodeFileItem
                    file={row.file}
                    fileNameOnly={
                      row.file.path.split("/").pop() || row.file.path
                    }
                    groupType={row.groupType}
                    onContextMenu={handleContextMenu}
                  />
                </div>
              ) : (
                <VscodeFileItem
                  file={row.file}
                  groupType={row.groupType}
                  onContextMenu={handleContextMenu}
                />
              )}
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <VscodeFileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          onClose={closeContextMenu}
        />
      )}
      {batchMenu && (
        <VscodeBatchContextMenu
          x={batchMenu.x}
          y={batchMenu.y}
          files={batchMenu.files}
          groupType={batchMenu.groupType}
          onClose={closeBatchMenu}
        />
      )}
    </>
  );
}
