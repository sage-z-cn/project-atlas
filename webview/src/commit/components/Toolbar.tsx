import { useCallback, useState } from "react";
import { bridge } from "../../shared/bridge";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { t } from "../../shared/i18n";
import ExpandAllIcon from "~icons/codicon/expand-all";
import CollapseAllIcon from "~icons/codicon/collapse-all";
import SettingsIcon from "~icons/codicon/settings";
import RefreshIcon from "~icons/codicon/refresh";
import FetchIcon from "~icons/codicon/repo-fetch";
import PullIcon from "~icons/codicon/repo-pull";
import PushIcon from "~icons/codicon/repo-push";
import DiffIcon from "~icons/codicon/diff";
import ShelveIcon from "~icons/codicon/git-stash";
import RollbackIcon from "~icons/codicon/discard";
import { useCommitStore } from "../../shared/store/commit-store";

interface ToolbarProps {
  onRefresh: () => void;
  onShelve: () => void;
  onRollback: () => void;
  hasChanges: boolean;
}

export function Toolbar({
  onRefresh,
  onShelve,
  onRollback,
  hasChanges,
}: ToolbarProps) {
  const [showViewMenu, setShowViewMenu] = useState(false);
  const { expandedGroups, toggleGroup, expandAllDirs } = useCommitStore();

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
    // Collapse file groups
    const groups = ["changes", "staged", "unversioned"];
    for (const g of groups) {
      if (expandedGroups.has(g)) {
        toggleGroup(g);
      }
    }
  }, [expandedGroups, toggleGroup]);

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
      <Tooltip text={t("Fetch")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={() => bridge.request("fetchAll")}
        >
          <FetchIcon />
        </button>
      </Tooltip>

      <div className="commit-toolbar-separator" />

      {/* Remote sync group */}
      <Tooltip text={t("Pull")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={() => bridge.request("pullBranch", {})}
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

      {/* Local changes group: view -> shelve -> rollback (by severity) */}
      <Tooltip text={t("Show Diff")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          disabled={!hasChanges}
        >
          <DiffIcon />
        </button>
      </Tooltip>
      <Tooltip text={t("Shelve Changes")}>
        <button
          type="button"
          className="commit-toolbar-btn"
          onClick={onShelve}
          disabled={!hasChanges}
        >
          <ShelveIcon />
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
