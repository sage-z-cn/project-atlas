import { useCallback, useRef, useState } from "react";
import { bridge } from "../../shared/bridge";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { t } from "../../shared/i18n";
import IconExpandAll from "~icons/codicon/expand-all";
import IconCollapseAll from "~icons/codicon/collapse-all";
import IconCollapsePanel from "~icons/codicon/layout-sidebar-left-off";
import IconAdd from "~icons/codicon/add";
import IconUpdate from "~icons/codicon/repo-pull";
import IconDelete from "~icons/codicon/trash";
import IconCompare from "~icons/codicon/git-compare";
import IconSearch from "~icons/codicon/search";
import IconFetch from "~icons/codicon/repo-fetch";
import IconStar from "~icons/codicon/star-full";
import IconLocate from "~icons/codicon/target";
import IconListFiles from "~icons/codicon/list-tree";
import IconSettings from "~icons/codicon/settings-gear";
import { usePanelStore } from "../../shared/store/panel-store";

export function BranchSidebar({
  onTogglePanel,
  onNewBranch,
}: {
  onTogglePanel?: () => void;
  onNewBranch?: () => void;
} = {}) {
  const selectedBranches = usePanelStore((s) => s.selectedBranches);
  const selectedBranch =
    selectedBranches.length === 1 ? selectedBranches[0] : null;
  const branchGroupByDirectory = usePanelStore((s) => s.branchGroupByDirectory);
  const toggleBranchGroupByDirectory = usePanelStore(
    (s) => s.toggleBranchGroupByDirectory,
  );
  const toggleFavorite = usePanelStore((s) => s.toggleFavorite);
  const toggleShowMyBranchesOnly = usePanelStore(
    (s) => s.toggleShowMyBranchesOnly,
  );
  const showMyBranchesOnly = usePanelStore((s) => s.showMyBranchesOnly);

  const handleNewBranch = useCallback(() => {
    if (onNewBranch) {
      onNewBranch();
    } else {
      bridge.request("createBranchPrompt", {});
    }
  }, [onNewBranch]);

  const handleUpdateSelected = useCallback(() => {
    if (selectedBranch) {
      bridge.request("pullBranch", { branchName: selectedBranch });
    }
  }, [selectedBranch]);

  const handleDeleteBranch = useCallback(() => {
    if (selectedBranch) {
      bridge.request("deleteBranchPrompt", { branchName: selectedBranch });
    }
  }, [selectedBranch]);

  const handleCompareWithCurrent = useCallback(() => {
    if (selectedBranch) {
      bridge.request("compareWithCurrent", { branchName: selectedBranch });
    }
  }, [selectedBranch]);

  const handleShowMyBranches = useCallback(() => {
    toggleShowMyBranchesOnly();
  }, [toggleShowMyBranchesOnly]);

  const handleFetch = useCallback(() => {
    bridge.request("fetchAll");
  }, []);

  const handleToggleFavorite = useCallback(() => {
    if (selectedBranch) {
      toggleFavorite(selectedBranch);
    }
  }, [selectedBranch, toggleFavorite]);

  const handleNavigateToHead = useCallback(() => {
    if (selectedBranch) {
      bridge.request("navigateToHead", { branchName: selectedBranch });
    }
  }, [selectedBranch]);

  const handleExpandAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent("branch-tree-expand-all"));
  }, []);

  const handleCollapseAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent("branch-tree-collapse-all"));
  }, []);

  return (
    <div className="branch-sidebar">
      {onTogglePanel && (
        <>
          <Tooltip text={t("Hide Branches")}>
            <button
              type="button"
              className="branch-sidebar-btn"
              onClick={onTogglePanel}
            >
              <IconCollapsePanel />
            </button>
          </Tooltip>
          <div className="branch-sidebar-separator" />
        </>
      )}
      {/* Branch add / delete */}
      <Tooltip text={t("New Branch")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleNewBranch}
        >
          <IconAdd />
        </button>
      </Tooltip>
      <Tooltip text={t("Delete Branch")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleDeleteBranch}
          disabled={!selectedBranch}
        >
          <IconDelete />
        </button>
      </Tooltip>
      <div className="branch-sidebar-separator" />
      {/* Remote sync */}
      <Tooltip text={t("Update Selected")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleUpdateSelected}
          disabled={!selectedBranch}
        >
          <IconUpdate />
        </button>
      </Tooltip>
      <Tooltip text={t("Fetch")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleFetch}
        >
          <IconFetch />
        </button>
      </Tooltip>
      <div className="branch-sidebar-separator" />
      {/* Inspect / navigate */}
      <Tooltip text={t("Compare with Current")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleCompareWithCurrent}
          disabled={!selectedBranch}
        >
          <IconCompare />
        </button>
      </Tooltip>
      <Tooltip text={t("Show My Branches")}>
        <button
          type="button"
          className={`branch-sidebar-btn${showMyBranchesOnly ? " active" : ""}`}
          onClick={handleShowMyBranches}
        >
          <IconSearch />
        </button>
      </Tooltip>
      <Tooltip text={t("Navigate Log to Selected Branch Head")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleNavigateToHead}
          disabled={!selectedBranch}
        >
          <IconLocate />
        </button>
      </Tooltip>
      <div className="branch-sidebar-separator" />
      {/* Marking / list layout */}
      <Tooltip text={t("Mark/Unmark As Favorite")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleToggleFavorite}
          disabled={!selectedBranch}
        >
          <IconStar />
        </button>
      </Tooltip>
      <Tooltip
        text={branchGroupByDirectory ? t("Flatten List") : t("Group By Directory")}
      >
        <button
          type="button"
          className={`branch-sidebar-btn${branchGroupByDirectory ? " active" : ""}`}
          onClick={toggleBranchGroupByDirectory}
        >
          <IconListFiles />
        </button>
      </Tooltip>

      <div className="branch-sidebar-spacer" />

      <Tooltip text={t("Expand All")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleExpandAll}
        >
          <IconExpandAll />
        </button>
      </Tooltip>
      <Tooltip text={t("Collapse All")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          onClick={handleCollapseAll}
        >
          <IconCollapseAll />
        </button>
      </Tooltip>
      <SettingsButton />
    </div>
  );
}

/* ─── Settings Button with Dropdown ──────────────────────────────── */

function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ left: 40, top: 200 });
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Tooltip text={t("Settings")}>
        <button
          type="button"
          className="branch-sidebar-btn"
          ref={btnRef}
          onClick={() => {
            const r = btnRef.current?.getBoundingClientRect();
            setAnchor({ left: r ? r.right + 2 : 40, top: r ? r.top : 200 });
            setOpen(!open);
          }}
        >
          <IconSettings />
        </button>
      </Tooltip>
      {open && (
        <SettingsMenu anchor={anchor} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function SettingsMenu({
  anchor,
  onClose,
}: {
  anchor: { left: number; top: number };
  onClose: () => void;
}) {
  const showTags = usePanelStore((s) => s.showTags);
  const singleClickAction = usePanelStore((s) => s.singleClickAction);
  const toggleShowTags = usePanelStore((s) => s.toggleShowTags);
  const setSingleClickAction = usePanelStore((s) => s.setSingleClickAction);

  const menuRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const handleClick = (e: MouseEvent) => {
        if (!node.contains(e.target as Node)) onClose();
      };
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
      return () => {
        document.removeEventListener("mousedown", handleClick);
        document.removeEventListener("keydown", handleKey);
      };
    },
    [onClose],
  );

  return (
    <div
      ref={menuRef}
      className="commit-context-menu"
      style={{
        position: "fixed",
        left: anchor.left,
        top: anchor.top,
        zIndex: 1000,
      }}
    >
      <div className="commit-context-menu-header">{t("On Single Click")}</div>
      <button
        type="button"
        className="commit-context-menu-item"
        onClick={() => {
          setSingleClickAction("updateBranchFilter");
          onClose();
        }}
      >
        <span className="commit-context-menu-icon">
          {singleClickAction === "updateBranchFilter" ? "✓" : ""}
        </span>
        <span>{t("Update Branch Filter")}</span>
      </button>
      <button
        type="button"
        className="commit-context-menu-item"
        onClick={() => {
          setSingleClickAction("navigateToHead");
          onClose();
        }}
      >
        <span className="commit-context-menu-icon">
          {singleClickAction === "navigateToHead" ? "✓" : ""}
        </span>
        <span>{t("Navigate Log to Branch Head")}</span>
      </button>
      <div className="commit-context-menu-separator" />
      <button
        type="button"
        className="commit-context-menu-item"
        onClick={() => {
          toggleShowTags();
          onClose();
        }}
      >
        <span className="commit-context-menu-icon">{showTags ? "✓" : ""}</span>
        <span>{t("Show Tags")}</span>
      </button>
    </div>
  );
}
