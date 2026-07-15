import { type CSSProperties } from "react";
import { useClampedPosition } from "../hooks/useClampedPosition";
import { useMenuDismiss } from "../hooks/useMenuDismiss";

/**
 * 通用右键菜单壳组件：负责视口边缘吸附（useClampedPosition）、
 * 关闭生命周期（useMenuDismiss：外部点击 / 右键 / Esc / 失焦 / 滚动 / 缩放）、
 * 以及 .context-menu / .context-menu-item / .context-menu-separator 的统一渲染。
 *
 * 调用方只需构建 items 数组（动态条件在构建处处理），无需关心定位与关闭。
 * 复用 recent.css 的 .context-menu 类名，故仅在 sidebar webview
 * （recent/favorites/tasks/todos，单 bundle 共享 CSS）中可用；commit webview
 * 不加载该类名，请使用自包含 inline style 的 RepoContextMenu。
 *
 * 点击任意非 disabled 菜单项后会自动调用 onClose，调用方的 onSelect 无需自行关闭。
 */
export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: React.ComponentType<{ width?: number; height?: number }>;
  onSelect: () => void;
  disabled?: boolean;
}
export interface ContextMenuSeparator {
  key: string;
  separator: true;
}
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const { ref, pos } = useClampedPosition(x, y);
  useMenuDismiss(ref, onClose);
  const style: CSSProperties = { left: pos.x, top: pos.y };

  return (
    <div
      className="context-menu"
      ref={ref}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) =>
        "separator" in item ? (
          <div key={item.key} className="context-menu-separator" />
        ) : (
          <div
            key={item.key}
            className={`context-menu-item${item.disabled ? " disabled" : ""}`}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            {item.icon && <item.icon width={14} height={14} />}
            <span>{item.label}</span>
          </div>
        ),
      )}
    </div>
  );
}
