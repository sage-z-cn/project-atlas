import { useEffect, useRef } from "react";

/**
 * textarea 动态高度：内容变化（或窗口 resize 引起换行点变化）时量
 * scrollHeight 设定 height，配合 CSS 的 min/max-height 实现行数上下限。
 *
 * scrollHeight 不含边框而 height 是 border-box，需补上边框差值
 * （offsetHeight - clientHeight = 上下边框合计），否则内容区恒差 2px，
 * 未到上限就会误判溢出出现滚动条。
 *
 * 用法：
 *   const taRef = useAutoResizeTextarea(value);
 *   <textarea ref={taRef} ... />
 *   CSS: min-height / max-height / overflow-y: auto 由调用方按行数配置。
 */
export function useAutoResizeTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const adjust = () => {
      el.style.height = "auto";
      const border = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + border}px`;
    };
    adjust();
    window.addEventListener("resize", adjust);
    return () => window.removeEventListener("resize", adjust);
  }, [value, ref]);

  return ref;
}
