import { useLayoutEffect, useRef, useState } from "react";

/**
 * 测量后吸附：先按期望 (x,y) 渲染，useLayoutEffect（同步、绘制前）读取实际
 * offsetWidth/Height，把菜单整体拉回视口内。复刻 legacy baseViewProvider.showMenu
 * 的动态测量逻辑（替代硬编码宽高估算，避免 i18n 长文案被裁）。
 *
 * 用法：
 *   const { ref, pos } = useClampedPosition(menu.x, menu.y);
 *   <div ref={ref} style={{ left: pos.x, top: pos.y }}>...</div>
 */
export function useClampedPosition(x: number, y: number): {
  ref: React.RefObject<HTMLDivElement | null>;
  pos: { x: number; y: number };
} {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    // 右溢出时向左展开（菜单右边对齐鼠标），避免贴视口右边与鼠标脱节
    if (x + w > vw - pad) nx = x - w;
    if (y + h > vh - pad) ny = vh - h - pad;
    if (nx < pad) nx = pad;
    if (ny < pad) ny = pad;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  return { ref, pos };
}
