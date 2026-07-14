import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import type { VscodeGroupType } from "./VscodeFileItem";
import AddIcon from "~icons/codicon/add";
import RemoveIcon from "~icons/codicon/remove";
import DiscardIcon from "~icons/codicon/discard";
import FolderIcon from "~icons/codicon/folder";
import MergeIcon from "~icons/codicon/git-merge";
import StashIcon from "~icons/codicon/archive";
import ShelveIcon from "~icons/codicon/save";

export interface VscodeBatchContextMenuProps {
  x: number;
  y: number;
  files: WorkingTreeFile[];
  groupType: VscodeGroupType;
  onClose: () => void;
}

export function VscodeBatchContextMenu({
  x,
  y,
  files,
  groupType,
  onClose,
}: VscodeBatchContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { stageFiles, unstageFiles, rollbackFiles, shelveChanges, ideaShelveChanges } =
    useCommitStore();

  // Position adjustment to keep menu in viewport
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: y,
    left: x,
  });

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;
      let top = y;
      let left = x;
      if (top + rect.height > viewportH) {
        const above = y - rect.height;
        top = above >= 4 ? above : Math.max(4, viewportH - rect.height - 4);
      }
      if (left + rect.width > viewportW) {
        left = Math.max(4, viewportW - rect.width - 4);
      }
      setPosition({ top, left });
    });
  }, [x, y]);

  // Close on outside click, Escape, blur, scroll, resize
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleBlur = () => onClose();
    const handleScroll = (e: Event) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        !menuRef.current.contains(e.target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleBlur);
    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleBlur);
    };
  }, [onClose]);

  const handleStageAll = useCallback(() => {
    void stageFiles(files.map((f) => f.path));
    onClose();
  }, [files, stageFiles, onClose]);

  const handleUnstageAll = useCallback(() => {
    void unstageFiles(files.map((f) => f.path));
    onClose();
  }, [files, unstageFiles, onClose]);

  const handleDiscardAll = useCallback(() => {
    // Backend rollbackFiles handler opens a modal confirmation.
    void rollbackFiles(files.map((f) => f.path));
    onClose();
  }, [files, rollbackFiles, onClose]);

  const handleStash = useCallback(async () => {
    onClose();
    const paths = files.map((f) => f.path);
    // Name is optional: cancel aborts, empty falls back to the default message.
    const result = (await bridge.request("showInputBox", {
      prompt: t("Enter stash message (optional):"),
      placeHolder: t("Stashed changes"),
    })) as { value: string | null };
    if (result.value === null) return;
    const message = result.value.trim() || t("Stashed changes");
    await shelveChanges(message, paths);
  }, [files, shelveChanges, onClose]);

  const handleShelve = useCallback(async () => {
    onClose();
    const paths = files.map((f) => f.path);
    const result = (await bridge.request("showInputBox", {
      prompt: t("Enter shelf name (optional):"),
      placeHolder: t("Shelved changes"),
    })) as { value: string | null };
    if (result.value === null) return;
    const message = result.value.trim() || t("Shelved changes");
    await ideaShelveChanges(message, paths);
  }, [files, ideaShelveChanges, onClose]);

  const handleReveal = useCallback(() => {
    if (files.length === 0) return;
    bridge.request("revealInSystemExplorer", { filePath: files[0].path });
    onClose();
  }, [files, onClose]);

  const handleResolve = useCallback(() => {
    bridge.request("openConflictsPanel");
    onClose();
  }, [onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    left: position.left,
    top: position.top,
    zIndex: 1000,
  };

  return (
    <div
      className="commit-context-menu vscode-context-menu"
      ref={menuRef}
      style={style}
    >
      {groupType === "changes" && (
        <>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleStageAll}
          >
            <span className="commit-context-menu-icon">
              <AddIcon />
            </span>
            <span>{t("Stage All Changes")}</span>
          </button>
          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleDiscardAll}
          >
            <span className="commit-context-menu-icon">
              <DiscardIcon />
            </span>
            <span>{t("Discard All Changes...")}</span>
          </button>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleStash}
          >
            <span className="commit-context-menu-icon">
              <StashIcon />
            </span>
            <span>{t("Stash Changes...")}</span>
          </button>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleShelve}
          >
            <span className="commit-context-menu-icon">
              <ShelveIcon />
            </span>
            <span>{t("Shelve Changes...")}</span>
          </button>
          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleReveal}
          >
            <span className="commit-context-menu-icon">
              <FolderIcon />
            </span>
            <span>{t("Open in System Folder")}</span>
          </button>
        </>
      )}

      {groupType === "staged" && (
        <>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleUnstageAll}
          >
            <span className="commit-context-menu-icon">
              <RemoveIcon />
            </span>
            <span>{t("Unstage All Changes")}</span>
          </button>
          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleStash}
          >
            <span className="commit-context-menu-icon">
              <StashIcon />
            </span>
            <span>{t("Stash Changes...")}</span>
          </button>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleShelve}
          >
            <span className="commit-context-menu-icon">
              <ShelveIcon />
            </span>
            <span>{t("Shelve Changes...")}</span>
          </button>
          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleReveal}
          >
            <span className="commit-context-menu-icon">
              <FolderIcon />
            </span>
            <span>{t("Open in System Folder")}</span>
          </button>
        </>
      )}

      {groupType === "merge" && (
        <button
          type="button"
          className="commit-context-menu-item"
          onClick={handleResolve}
        >
          <span className="commit-context-menu-icon">
            <MergeIcon />
          </span>
          <span>{t("Resolve Conflicts")}</span>
        </button>
      )}
    </div>
  );
}
