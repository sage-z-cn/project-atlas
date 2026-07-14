import { useMemo, useState } from "react";
import type React from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { t } from "../../shared/i18n";
import { VscodeFileGroup } from "./VscodeFileGroup";
import { VscodeFileContextMenu } from "./VscodeFileContextMenu";
import { VscodeBatchContextMenu } from "./VscodeBatchContextMenu";
import type { VscodeGroupType } from "./VscodeFileItem";

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
}

export function VscodeCommitList() {
  const {
    changes,
    expandedGroups,
    groupByDirectory,
    highlightedFiles,
    toggleGroup,
  } = useCommitStore();

  const [contextMenu, setContextMenu] = useState<VscodeContextMenuState | null>(
    null,
  );
  const [batchMenu, setBatchMenu] = useState<VscodeBatchMenuState | null>(null);

  // VSCode-style grouping (untracked folded into Changes):
  //   Merge Changes (conflicted) -> Staged Changes -> Changes (rest, incl untracked)
  const { conflicted, staged, unstaged } = useMemo(() => {
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
    return { conflicted: cf, staged: st, unstaged: un };
  }, [changes]);

  const handleContextMenu = (e: React.MouseEvent, file: WorkingTreeFile) => {
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleGroupContextMenu = (
    e: React.MouseEvent,
    files: WorkingTreeFile[],
    groupType: VscodeGroupType,
  ) => {
    setBatchMenu({ x: e.clientX, y: e.clientY, files, groupType });
  };

  const handleDirContextMenu = (
    e: React.MouseEvent,
    files: WorkingTreeFile[],
    groupType: VscodeGroupType,
  ) => {
    setBatchMenu({ x: e.clientX, y: e.clientY, files, groupType });
  };

  const closeBatchMenu = () => setBatchMenu(null);

  return (
    <>
      {conflicted.length > 0 && (
        <VscodeFileGroup
          groupType="merge"
          label={t("Merge Changes")}
          files={conflicted}
          expanded={expandedGroups.has("conflicts")}
          groupByDirectory={groupByDirectory}
          highlightedFiles={highlightedFiles}
          onToggle={() => toggleGroup("conflicts")}
          onContextMenu={handleContextMenu}
          onGroupContextMenu={handleGroupContextMenu}
          onDirContextMenu={handleDirContextMenu}
        />
      )}
      {staged.length > 0 && (
        <VscodeFileGroup
          groupType="staged"
          label={t("Staged Changes")}
          files={staged}
          expanded={expandedGroups.has("staged")}
          groupByDirectory={groupByDirectory}
          highlightedFiles={highlightedFiles}
          onToggle={() => toggleGroup("staged")}
          onContextMenu={handleContextMenu}
          onGroupContextMenu={handleGroupContextMenu}
          onDirContextMenu={handleDirContextMenu}
        />
      )}
      {unstaged.length > 0 && (
        <VscodeFileGroup
          groupType="changes"
          label={t("Changes")}
          files={unstaged}
          expanded={expandedGroups.has("changes")}
          groupByDirectory={groupByDirectory}
          highlightedFiles={highlightedFiles}
          onToggle={() => toggleGroup("changes")}
          onContextMenu={handleContextMenu}
          onGroupContextMenu={handleGroupContextMenu}
          onDirContextMenu={handleDirContextMenu}
        />
      )}

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
