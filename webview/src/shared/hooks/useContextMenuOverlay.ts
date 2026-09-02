import { useEffect, useRef } from "react";

/**
 * Context-menu overlay close logic: outside mousedown, Escape, and window
 * blur. Returns the ref callers must attach to the menu container so clicks
 * inside the menu don't close it.
 *
 * 收敛 StashContextMenu / StashFileContextMenu 的关闭逻辑。其他菜单组件
 * （CommitFileContextMenu / Vscode*ContextMenu）带额外的 scroll/resize
 * 关闭与 capture 阶段监听，刻意不迁移。
 */
export function useContextMenuOverlay(onClose: () => void) {
  const menuRef = useRef<HTMLDivElement>(null);

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
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", handleBlur);
    };
  }, [onClose]);

  return menuRef;
}
