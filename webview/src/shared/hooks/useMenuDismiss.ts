import { useEffect } from "react";

/**
 * 浮动菜单统一的关闭逻辑：在菜单元素之外的任意位置发生 mousedown /
 * contextmenu，或按 Esc，或窗口失焦，或滚动/缩放时，触发 onClose。
 *
 * 抽取自 RepoContextMenu 的 dismiss 生命周期（捕获阶段监听 document，
 * 确保在目标元素的 React 处理之前即可判定是否点在菜单外部）。
 *
 * 用法：
 *   const { ref, pos } = useClampedPosition(x, y);
 *   useMenuDismiss(ref, onClose);
 *   <div ref={ref} ...>...</div>
 */
export function useMenuDismiss(
  ref: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const handleOutside = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    const handleBlur = (): void => onClose();
    const handleScroll = (e: Event): void => {
      if (
        ref.current &&
        e.target instanceof Node &&
        !ref.current.contains(e.target)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleOutside, true);
    document.addEventListener("contextmenu", handleOutside, true);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleBlur);

    return () => {
      document.removeEventListener("mousedown", handleOutside, true);
      document.removeEventListener("contextmenu", handleOutside, true);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleBlur);
    };
  }, [ref, onClose]);
}
