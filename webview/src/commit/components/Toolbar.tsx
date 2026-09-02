import { useCallback, useEffect, useState } from "react";
import { bridge } from "../../shared/bridge";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { t } from "../../shared/i18n";
import ExpandAllIcon from "~icons/codicon/expand-all";
import CollapseAllIcon from "~icons/codicon/collapse-all";
import SettingsIcon from "~icons/codicon/settings";
import RefreshIcon from "~icons/codicon/refresh";
import PullIcon from "~icons/codicon/repo-pull";
import PushIcon from "~icons/codicon/repo-push";
import StashIcon from "~icons/codicon/archive";
import RollbackIcon from "~icons/codicon/discard";
import { useCommitStore } from "../../shared/store/commit-store";
import { buildDirTree, collectDirPaths } from "../utils/dirTree";
import { promptAndStash } from "../utils/stashPrompt";

interface ToolbarProps {
  onRefresh: () => void;
  onRollback: () => void;
  hasChanges: boolean;
}

export function Toolbar({
  onRefresh,
  onRollback,
  hasChanges,
}: ToolbarProps) {
  const [showViewMenu, setShowViewMenu] = useState(false);
  const {
    expandedGroups,
    toggleGroup,
    expandAllDirs,
    collapseAllDirs,
    commitListStyle,
    groupByDirectory,
    changes,
  } = useCommitStore();

  const handleExpandAll = useCallback(() => {
    // Expand file groups
    const groups = ["changes", "staged", "unversioned"];
    for (const g of groups) {
      if (!expandedGroups.has(g)) {
        toggleGroup(g);
      }
    }
    // Expand all directories in tree view
    expandAllDirs();
  }, [expandedGroups, toggleGroup, expandAllDirs]);

  const handleCollapseAll = useCallback(() => {
    // vscode 风格 + 按目录分组：对齐 VSCode 资源管理器 Collapse All 语义 ——
    // 顶层分组保持当前展开态不动，收起目录树全部节点（含嵌套中间目录，
    // 每组只剩第一层目录可见且为收起态；根级文件不涉及目录，自然保持显示）。
    // 目录 key 必须取自 buildDirTree（含 compact）的 fullPath，与
    // VscodeDirNodeView 消费 collapsedDirs 的 key 同源。
    if (commitListStyle === "vscode" && groupByDirectory) {
      collapseAllDirs(collectDirPaths(buildDirTree(changes)));
      return;
    }
    // jetbrains 风格（或 vscode 风格但未按目录分组）：折叠顶层分组（现状行为）。
    const groups = ["changes", "staged", "unversioned"];
    for (const g of groups) {
      if (expandedGroups.has(g)) {
        toggleGroup(g);
      }
    }
  }, [
    commitListStyle,
    groupByDirectory,
    changes,
    collapseAllDirs,
    expandedGroups,
    toggleGroup,
  ]);

  return (
    <div className="commit-toolbar">
      {/* Refresh group: local refresh + remote fetch */}
      <Tooltip text={t("Refresh")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={onRefresh}
        >
          <RefreshIcon />
        </button>
      </Tooltip>
      <div className="commit-toolbar-separator" />

      {/* Remote sync group */}
      <Tooltip text={t("Pull")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={async () => {
            const { setRemoteError } = useCommitStore.getState();
            setRemoteError(null);
            try {
              await bridge.request("pullBranch", {});
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setRemoteError(msg);
            }
          }}
        >
          <PullIcon />
        </button>
      </Tooltip>
      <Tooltip text={t("Push...")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={() => bridge.request("openPushPanel")}
        >
          <PushIcon />
        </button>
      </Tooltip>

      <div className="commit-toolbar-separator" />
      {/* Stash: 全量入口（vscode 列表风格下弹窗内可选范围，见 StashPromptModal）。 */}
      <Tooltip text={t("Stash Changes...")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={() => void promptAndStash(undefined)}
          disabled={!hasChanges}
        >
          <StashIcon />
        </button>
      </Tooltip>
      <Tooltip text={t("Rollback")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={onRollback}
          disabled={!hasChanges}
        >
          <RollbackIcon />
        </button>
      </Tooltip>

      <div className="commit-toolbar-spacer" />

      <Tooltip text={t("Expand All")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={handleExpandAll}
        >
          <ExpandAllIcon />
        </button>
      </Tooltip>
      <Tooltip text={t("Collapse All")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={handleCollapseAll}
        >
          <CollapseAllIcon />
        </button>
      </Tooltip>
      <div style={{ position: "relative" }}>
        <Tooltip text={t("Options")}>
          <button
            type="button"
            className="commit-toolbar-btn"
            onClick={() => setShowViewMenu(!showViewMenu)}
          >
            <SettingsIcon />
          </button>
        </Tooltip>
        {showViewMenu && (
          <ViewOptionsMenu onClose={() => setShowViewMenu(false)} />
        )}
      </div>
    </div>
  );
}

/* ─── View Options Menu ──────────────────────────────────────────── */

function ViewOptionsMenu({ onClose }: { onClose: () => void }) {
  const {
    groupByDirectory,
    toggleGroupByDirectory,
    showUnversioned,
    toggleShowUnversioned,
    commitListStyle,
    setCommitListStyle,
    commitBadgeMode,
    setCommitBadgeMode,
  } = useCommitStore();

  useEffect(() => {
    const handleBlur = () => onClose();
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [onClose]);

  return (
    <>
      {/* Backdrop to close */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 999 }}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      />
      <div
        className="commit-context-menu"
        style={{
          position: "absolute",
          top: "100%",
          right: 0,
          marginTop: 4,
          zIndex: 1000,
        }}
      >
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            void bridge.request("openGitSettings");
            onClose();
          }}
        >
          <span className="commit-context-menu-icon" />
          <span>{t("Open Settings")}</span>
        </button>
        <div className="commit-context-menu-separator" />
        <div className="commit-context-menu-header">{t("List Style")}</div>
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            void setCommitListStyle("vscode");
            onClose();
          }}
        >
          <span className="commit-context-menu-icon">
            {commitListStyle === "vscode" && <CheckIcon />}
          </span>
          <span>{t("VSCode")}</span>
        </button>
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            void setCommitListStyle("jetbrains");
            onClose();
          }}
        >
          <span className="commit-context-menu-icon">
            {commitListStyle === "jetbrains" && <CheckIcon />}
          </span>
          <span>{t("JetBrains")}</span>
        </button>
        <div className="commit-context-menu-separator" />
        <div className="commit-context-menu-header">{t("Group By")}</div>
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            toggleGroupByDirectory();
            onClose();
          }}
        >
          <span className="commit-context-menu-icon">
            {groupByDirectory && <CheckIcon />}
          </span>
          <span>{t("Directory")}</span>
          <span className="commit-context-menu-shortcut">^P</span>
        </button>
        <div className="commit-context-menu-separator" />
        <div className="commit-context-menu-header">{t("Show")}</div>
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            toggleShowUnversioned();
            onClose();
          }}
        >
          <span className="commit-context-menu-icon">
            {showUnversioned && <CheckIcon />}
          </span>
          <span>{t("Unversioned Files")}</span>
        </button>
        <div className="commit-context-menu-separator" />
        <div className="commit-context-menu-header">{t("Badge")}</div>
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            void setCommitBadgeMode("total");
            onClose();
          }}
        >
          <span className="commit-context-menu-icon">
            {commitBadgeMode === "total" && <CheckIcon />}
          </span>
          <span>{t("Total")}</span>
        </button>
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            void setCommitBadgeMode("current");
            onClose();
          }}
        >
          <span className="commit-context-menu-icon">
            {commitBadgeMode === "current" && <CheckIcon />}
          </span>
          <span>{t("Current")}</span>
        </button>
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={() => {
            void setCommitBadgeMode("off");
            onClose();
          }}
        >
          <span className="commit-context-menu-icon">
            {commitBadgeMode === "off" && <CheckIcon />}
          </span>
          <span>{t("Off")}</span>
        </button>
      </div>
    </>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
