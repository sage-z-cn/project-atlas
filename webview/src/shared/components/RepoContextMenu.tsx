import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bridge } from "../bridge";
import { t } from "../i18n";
import type { RepoInfo } from "../types/git";
import CopyIcon from "~icons/codicon/copy";
import FolderIcon from "~icons/codicon/folder";
import FolderOpenedIcon from "~icons/codicon/folder-opened";
import TerminalIcon from "~icons/codicon/terminal";

interface RepoContextMenuProps {
  x: number;
  y: number;
  repo: RepoInfo;
  /** Full chip list — enables the move actions when length > 1. */
  repos?: RepoInfo[];
  onClose: () => void;
  /** Called with the new path order after a move action. */
  onReorder?: (order: string[]) => void;
  /**
   * Chip list layout direction — the menu serves both the horizontal panel
   * strip and the vertical commit sidebar, so "earlier/later" must read as
   * Left/Right or Up/Down accordingly. Defaults to "horizontal".
   */
  orientation?: "horizontal" | "vertical";
}

/**
 * Right-click context menu for a repo chip (RepoSelector). Self-contained with
 * inline styles + VSCode theme variables so it renders correctly in BOTH the
 * panel webview and the commit webview (the commit-context-menu CSS classes
 * are only loaded in the commit webview). Mirrors the position-clamp /
 * dismiss-on-outside-click lifecycle of the other context menus.
 */
export function RepoContextMenu({
  x,
  y,
  repo,
  repos,
  onClose,
  onReorder,
  orientation = "horizontal",
}: RepoContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Clamp the menu inside the viewport after first measure.
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
        // 右溢出时向左展开（菜单右边对齐鼠标），与 useClampedPosition 行为一致
        left = Math.max(4, x - rect.width);
      }
      setPosition({ top, left });
    });
  }, [x, y]);

  // Dismiss on outside click / Escape / blur / scroll / resize.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
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
    const handleContextMenu = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleBlur);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleBlur);
    };
  }, [onClose]);

  const handleCopyPath = async () => {
    onClose();
    try {
      await bridge.request("copyToClipboard", { text: repo.path });
    } catch (err) {
      console.error("Copy path failed:", err);
    }
  };

  const handleCopyName = async () => {
    onClose();
    try {
      await bridge.request("copyToClipboard", { text: repo.name });
    } catch (err) {
      console.error("Copy name failed:", err);
    }
  };

  const handleRevealVscode = async () => {
    onClose();
    // No filePath → host reveals the repo root itself (see uiHandlers).
    try {
      await bridge.request("revealInExplorer", { repoPath: repo.path });
    } catch (err) {
      console.error("Reveal failed:", err);
    }
  };

  const handleRevealSystem = async () => {
    onClose();
    try {
      await bridge.request("revealInSystemExplorer", { repoPath: repo.path });
    } catch (err) {
      console.error("Reveal failed:", err);
    }
  };

  const handleOpenTerminal = async () => {
    onClose();
    try {
      await bridge.request("openInTerminal", { repoPath: repo.path });
    } catch (err) {
      console.error("Open terminal failed:", err);
    }
  };

  const repoList = repos ?? [];
  const idx = repoList.findIndex((r) => r.path === repo.path);
  const canMove = repoList.length > 1 && idx >= 0 && !!onReorder;

  // earlier/later = 数组下标向前/向后（方向中性）；显示文案随 orientation
  // 映射为 Left/Right（横向条）或 Up/Down（纵向堆叠）。
  const handleMoveEarlier = () => {
    onClose();
    if (!canMove || idx <= 0) return;
    const order = repoList.map((r) => r.path);
    [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
    onReorder?.(order);
  };

  const handleMoveLater = () => {
    onClose();
    if (!canMove || idx < 0 || idx >= repoList.length - 1) return;
    const order = repoList.map((r) => r.path);
    [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
    onReorder?.(order);
  };

  const handleMoveToStart = () => {
    onClose();
    if (!canMove || idx <= 0) return;
    const order = repoList.map((r) => r.path);
    order.splice(idx, 1);
    order.unshift(repo.path);
    onReorder?.(order);
  };

  const handleMoveToEnd = () => {
    onClose();
    if (!canMove || idx < 0 || idx >= repoList.length - 1) return;
    const order = repoList.map((r) => r.path);
    order.splice(idx, 1);
    order.push(repo.path);
    onReorder?.(order);
  };

  const items: {
    label: string;
    action: () => void;
    separator?: boolean;
    icon?: React.ReactNode;
    disabled?: boolean;
  }[] = [
    { label: t("Copy Path"), action: handleCopyPath, icon: <CopyIcon /> },
    { label: t("Copy Repo Name"), action: handleCopyName, icon: <CopyIcon /> },
    { label: "", action: () => {}, separator: true },
    {
      label: t("Reveal in Explorer"),
      action: handleRevealVscode,
      icon: <FolderOpenedIcon />,
    },
    {
      label: t("Reveal in File Explorer"),
      action: handleRevealSystem,
      icon: <FolderIcon />,
    },
    { label: "", action: () => {}, separator: true },
    {
      label: t("Open in Integrated Terminal"),
      action: handleOpenTerminal,
      icon: <TerminalIcon />,
    },
  ];

  if (canMove) {
    items.push(
      { label: "", action: () => {}, separator: true },
      {
        label: orientation === "vertical" ? t("Move Up") : t("Move Left"),
        action: handleMoveEarlier,
        disabled: idx <= 0,
      },
      {
        label: orientation === "vertical" ? t("Move Down") : t("Move Right"),
        action: handleMoveLater,
        disabled: idx >= repoList.length - 1,
      },
      {
        label: t("Move to Start"),
        action: handleMoveToStart,
        disabled: idx <= 0,
      },
      {
        label: t("Move to End"),
        action: handleMoveToEnd,
        disabled: idx >= repoList.length - 1,
      },
    );
  }

  const menu = (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: position ? position.top : -9999,
        left: position ? position.left : -9999,
        zIndex: 9999,
        background: "var(--vscode-menu-background, #1e1e1e)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        borderRadius: 4,
        padding: "4px 0",
        minWidth: 200,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        visibility: position ? "visible" : "hidden",
      }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div
            key={`sep-${i}`}
            style={{
              height: 1,
              background:
                "var(--vscode-menu-separatorBackground, #454545)",
              margin: "4px 0",
            }}
          />
        ) : (
          <div
            key={item.label}
            onClick={item.disabled ? undefined : item.action}
            style={{
              padding: "6px 12px",
              cursor: item.disabled ? "default" : "pointer",
              opacity: item.disabled ? 0.45 : 1,
              color: "var(--vscode-menu-foreground, #ccc)",
              fontSize: "13px",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              (e.currentTarget as HTMLElement).style.background =
                "var(--vscode-list-hoverBackground, #2a2d2e)";
              (e.currentTarget as HTMLElement).style.color =
                "var(--vscode-menu-selectionForeground, #fff)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color =
                "var(--vscode-menu-foreground, #ccc)";
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                flexShrink: 0,
                opacity: 0.7,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {item.icon ?? null}
            </span>
            {item.label}
          </div>
        ),
      )}
    </div>
  );

  return createPortal(menu, document.body);
}
