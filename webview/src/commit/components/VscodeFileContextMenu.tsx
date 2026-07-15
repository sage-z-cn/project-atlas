import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkingTreeFile } from "../../shared/store/commit-store";
import { useCommitStore } from "../../shared/store/commit-store";
import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import OpenFileIcon from "~icons/codicon/go-to-file";
import DiffIcon from "~icons/codicon/git-compare";
import AddIcon from "~icons/codicon/add";
import RemoveIcon from "~icons/codicon/remove";
import DiscardIcon from "~icons/codicon/discard";
import RevealIcon from "~icons/codicon/folder";
import CopyIcon from "~icons/codicon/copy";
import MergeIcon from "~icons/codicon/git-merge";
import HistoryIcon from "~icons/codicon/history";
import StashIcon from "~icons/codicon/archive";
import ShelveIcon from "~icons/codicon/save";

export interface VscodeFileContextMenuProps {
  x: number;
  y: number;
  file: WorkingTreeFile;
  onClose: () => void;
}

export function VscodeFileContextMenu({
  x,
  y,
  file,
  onClose,
}: VscodeFileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    stageFile,
    unstageFile,
    rollbackFile,
    showDiff,
    shelveChanges,
    ideaShelveChanges,
    currentRepoPath,
    highlightedFiles,
    changes,
  } = useCommitStore();

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

  const fileKey = `${file.path}:${file.staged}`;
  const multiSelected =
    highlightedFiles.size > 1 && highlightedFiles.has(fileKey);

  // Resolve the set of target paths for batch operations when multiple are
  // highlighted and the right-clicked file is among them.
  const resolvePaths = useCallback((): string[] => {
    if (multiSelected) {
      return changes
        .filter((f) => highlightedFiles.has(`${f.path}:${f.staged}`))
        .map((f) => f.path);
    }
    return [file.path];
  }, [multiSelected, highlightedFiles, changes, file.path]);

  const isConflicted = file.status === "conflicted";

  const handleOpenFile = useCallback(() => {
    bridge.request("openFile", { filePath: file.path });
    onClose();
  }, [file.path, onClose]);

  const handleShowFileHistory = useCallback(() => {
    bridge.request("showFileHistory", {
      filePath: file.path,
      repoPath: currentRepoPath,
    });
    onClose();
  }, [file.path, currentRepoPath, onClose]);

  const handleOpenChanges = useCallback(() => {
    showDiff(file.path, file.staged);
    onClose();
  }, [file, showDiff, onClose]);

  const handleStage = useCallback(() => {
    const paths = resolvePaths();
    void Promise.all(paths.map((p) => stageFile(p)));
    onClose();
  }, [resolvePaths, stageFile, onClose]);

  const handleUnstage = useCallback(() => {
    const paths = resolvePaths();
    void Promise.all(paths.map((p) => unstageFile(p)));
    onClose();
  }, [resolvePaths, unstageFile, onClose]);

  const handleReveal = useCallback(() => {
    bridge.request("revealInSystemExplorer", { filePath: file.path });
    onClose();
  }, [file.path, onClose]);

  const handleRevealVscode = useCallback(() => {
    bridge.request("revealInExplorer", {
      filePath: file.path,
      repoPath: currentRepoPath,
    });
    onClose();
  }, [file.path, currentRepoPath, onClose]);

  const handleCopyRelative = useCallback(() => {
    navigator.clipboard.writeText(file.path).catch(() => {});
    onClose();
  }, [file.path, onClose]);

  const handleCopyPath = useCallback(() => {
    const abs = currentRepoPath
      ? `${currentRepoPath}/${file.path}`
      : file.path;
    navigator.clipboard.writeText(abs).catch(() => {});
    onClose();
  }, [file.path, currentRepoPath, onClose]);

  const handleDiscard = useCallback(() => {
    // Backend rollbackFile handler opens a modal confirmation.
    rollbackFile(file.path);
    onClose();
  }, [file, rollbackFile, onClose]);

  const handleStash = useCallback(async () => {
    onClose();
    const paths = resolvePaths();
    // Name is optional: cancel aborts, empty falls back to the default message.
    const result = (await bridge.request("showInputBox", {
      prompt: t("Enter stash message (optional):"),
      placeHolder: t("Stashed changes"),
    })) as { value: string | null };
    if (result.value === null) return;
    const message = result.value.trim() || t("Stashed changes");
    await shelveChanges(message, paths);
  }, [resolvePaths, shelveChanges, onClose]);

  const handleShelve = useCallback(async () => {
    onClose();
    const paths = resolvePaths();
    const result = (await bridge.request("showInputBox", {
      prompt: t("Enter shelf name (optional):"),
      placeHolder: t("Shelved changes"),
    })) as { value: string | null };
    if (result.value === null) return;
    const message = result.value.trim() || t("Shelved changes");
    await ideaShelveChanges(message, paths);
  }, [resolvePaths, ideaShelveChanges, onClose]);

  const handleOpenMerge = useCallback(() => {
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
    <div className="commit-context-menu vscode-context-menu" ref={menuRef} style={style}>
      {/* Open File (all groups) */}
      <button
        type="button"
        className="commit-context-menu-item"
        onClick={handleOpenFile}
      >
        <span className="commit-context-menu-icon">
          <OpenFileIcon />
        </span>
        <span>{t("Open File")}</span>
      </button>
      <button
        type="button"
        className="commit-context-menu-item"
        onClick={handleShowFileHistory}
      >
        <span className="commit-context-menu-icon">
          <HistoryIcon />
        </span>
        <span>{t("Show File History")}</span>
      </button>

      {isConflicted ? (
        <>
          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleOpenMerge}
          >
            <span className="commit-context-menu-icon">
              <MergeIcon />
            </span>
            <span>{t("Open Merge Editor")}</span>
          </button>
          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleCopyPath}
          >
            <span className="commit-context-menu-icon">
              <CopyIcon />
            </span>
            <span>{t("Copy Absolute Path")}</span>
          </button>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleCopyRelative}
          >
            <span className="commit-context-menu-icon">
              <CopyIcon />
            </span>
            <span>{t("Copy Relative Path")}</span>
          </button>
        </>
      ) : (
        <>
          <div className="commit-context-menu-separator" />
          {/* Stage / Unstage */}
          {file.staged ? (
            <button
              type="button"
              className="commit-context-menu-item"
              onClick={handleUnstage}
            >
              <span className="commit-context-menu-icon">
                <RemoveIcon />
              </span>
              <span>{t("Unstage Changes")}</span>
            </button>
          ) : (
            <button
              type="button"
              className="commit-context-menu-item"
              onClick={handleStage}
            >
              <span className="commit-context-menu-icon">
                <AddIcon />
              </span>
              <span>{t("Stage Changes")}</span>
            </button>
          )}

          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleOpenChanges}
          >
            <span className="commit-context-menu-icon">
              <DiffIcon />
            </span>
            <span>{t("Open Changes")}</span>
          </button>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleRevealVscode}
          >
            <span className="commit-context-menu-icon">
              <RevealIcon />
            </span>
            <span>{t("Reveal in Explorer")}</span>
          </button>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleReveal}
          >
            <span className="commit-context-menu-icon">
              <RevealIcon />
            </span>
            <span>{t("Reveal in File Explorer")}</span>
          </button>

          <div className="commit-context-menu-separator" />
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleCopyPath}
          >
            <span className="commit-context-menu-icon">
              <CopyIcon />
            </span>
            <span>{t("Copy Absolute Path")}</span>
          </button>
          <button
            type="button"
            className="commit-context-menu-item"
            onClick={handleCopyRelative}
          >
            <span className="commit-context-menu-icon">
              <CopyIcon />
            </span>
            <span>{t("Copy Relative Path")}</span>
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

          {/* Discard (changes only) */}
          {!file.staged && (
            <>
              <div className="commit-context-menu-separator" />
              <button
                type="button"
                className="commit-context-menu-item"
                onClick={handleDiscard}
              >
                <span className="commit-context-menu-icon">
                  <DiscardIcon />
                </span>
                <span>{t("Discard Changes...")}</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
