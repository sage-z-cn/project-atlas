import { useEffect, useRef, type RefObject } from "react";

/**
 * 框选（rubber band / marquee）选择 hook。复刻 legacy baseViewProvider
 * 的 rubberBandScript 行为：
 *   - 在空白处按下左键开始框选（点在 item 上或右键菜单上不触发）
 *   - 拖动时实时用矩形相交判定高亮 item（直接操作 DOM class，避免每帧 React 重渲染）
 *   - 松开后按修饰键把相交 item 写入选择：
 *       无修饰 → 替换；Ctrl/Cmd → 切换；Shift → 追加
 *   - 拖动距离 < 5px 视为点击空白：清空选择（无修饰键时）
 *
 * handlers 存 ref（不进 effect 依赖），避免父组件每次渲染传入新对象导致 effect
 * 重建——拖拽途中若收到数据变更事件触发重渲染，重建会重置框选框导致拖拽失效。
 *
 * @param containerRef 列表容器的 ref
 * @param itemSelector item 元素选择器（如 ".recent-item"）
 * @param handlers 回调
 */
export function useRubberBand(
  containerRef: RefObject<HTMLElement | null>,
  itemSelector: string,
  handlers: {
    /** 框选结束，返回最终相交的 item id（按 DOM 顺序）。 */
    onSelection: (
      ids: string[],
      modifiers: { ctrl: boolean; shift: boolean },
    ) => void;
    /** 小拖动（<5px）= 点击空白：清空选择（无修饰键时）。 */
    onEmptyClick: (modifiers: { ctrl: boolean; shift: boolean }) => void;
  },
): void {
  const selectingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 创建框选可视化元素（挂在 body 上，position:fixed）
    const box = document.createElement("div");
    box.className = "rubber-band-box";
    box.style.display = "none";
    document.body.appendChild(box);

    const fullSelector = `${itemSelector}`;

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      // 点在 item 上、或右键菜单上不触发框选
      if (target.closest(itemSelector)) return;
      if (target.closest(".context-menu")) return;

      selectingRef.current = true;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      box.style.display = "block";
      box.style.left = `${e.clientX}px`;
      box.style.top = `${e.clientY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!selectingRef.current) return;
      const x = Math.min(startXRef.current, e.clientX);
      const y = Math.min(startYRef.current, e.clientY);
      const w = Math.abs(e.clientX - startXRef.current);
      const h = Math.abs(e.clientY - startYRef.current);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;

      const boxRect = box.getBoundingClientRect();
      container.querySelectorAll(fullSelector).forEach((node) => {
        const r = node.getBoundingClientRect();
        const hit = !(
          r.right < boxRect.left ||
          r.left > boxRect.right ||
          r.bottom < boxRect.top ||
          r.top > boxRect.bottom
        );
        node.classList.toggle("selecting", hit && w > 0 && h > 0);
      });
    };

    const onMouseUp = (e: MouseEvent): void => {
      if (!selectingRef.current) return;
      selectingRef.current = false;
      // 清掉拖动期高亮 class
      container
        .querySelectorAll(`${fullSelector}.selecting`)
        .forEach((n) => n.classList.remove("selecting"));

      const rect = box.getBoundingClientRect();
      box.style.display = "none";

      const modifiers = {
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
      };
      const h = handlersRef.current;

      // 小拖动 = 点击空白
      if (rect.width < 5 && rect.height < 5) {
        h.onEmptyClick(modifiers);
        return;
      }

      const ids: string[] = [];
      container.querySelectorAll(fullSelector).forEach((node) => {
        const r = node.getBoundingClientRect();
        const intersects = !(
          r.right < rect.left ||
          r.left > rect.right ||
          r.bottom < rect.top ||
          r.top > rect.bottom
        );
        if (intersects) {
          const id = node.getAttribute("data-id");
          if (id) ids.push(id);
        }
      });

      if (ids.length > 0) {
        h.onSelection(ids, modifiers);
        // 框选成功后，浏览器仍会在 mousedown/mouseup 共同祖先上触发 click 事件，
        // 冒泡到 document 的 click 监听会清空刚做的选择。复刻 legacy
        // baseViewProvider.ts:426 的 selectionJustMade 语义：用一次性 capture
        // 阶段监听消费下一个 click（capture 早于 App 的 bubble 监听）。
        const suppress = (ev: MouseEvent): void => {
          ev.stopPropagation();
          ev.preventDefault();
          document.removeEventListener("click", suppress, true);
        };
        document.addEventListener("click", suppress, true);
      } else if (!modifiers.ctrl && !modifiers.shift) {
        h.onEmptyClick(modifiers);
      }
    };

    container.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      box.remove();
    };
  }, [containerRef, itemSelector]);
}
