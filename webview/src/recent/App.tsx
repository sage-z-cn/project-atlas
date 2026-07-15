import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../shared/i18n";
import { ContextMenu, type ContextMenuEntry } from "../shared/components/ContextMenu";
import { ProjectIcon } from "../shared/components/ProjectIcon";
import { useRubberBand } from "../shared/hooks/useRubberBand";
import {
  useRecentStore,
  type RecentItemDto,
  type RecentAction,
} from "../shared/store/recent-store";
import IconLinkExternal from "~icons/codicon/link-external";
import IconOpenInProduct from "~icons/codicon/open-in-product";
import IconFolder from "~icons/codicon/folder";
import IconCopy from "~icons/codicon/copy";
import IconStarEmpty from "~icons/codicon/star-empty";
import IconEdit from "~icons/codicon/edit";
import IconTrash from "~icons/codicon/trash";
import "./recent.css";

// 右键 / hover 动作元数据（label 走 i18n，icon 走 codicon 组件）。
interface ActionMeta {
  action: RecentAction;
  label: string;
  Icon: (props: { width?: number; height?: number }) => React.JSX.Element;
  /** multi=true 才允许多选时执行；否则多选时禁用。 */
  multi?: boolean;
  sep?: false;
}
interface ActionSep {
  sep: true;
}
type MenuItem = ActionMeta | ActionSep;

const PROJECT_MENU: MenuItem[] = [
  { action: "openInNewWindow", label: "Open in New Window", Icon: IconLinkExternal },
  { action: "openInCurrentWindow", label: "Open in Current Window", Icon: IconOpenInProduct },
  { action: "revealInExplorer", label: "Reveal in File Explorer", Icon: IconFolder },
  { action: "copyPath", label: "Copy Path", Icon: IconCopy },
  { sep: true },
  { action: "addFavorite", label: "Add to Favorites", Icon: IconStarEmpty, multi: true },
  { action: "renameProject", label: "Rename", Icon: IconEdit },
  { action: "removeProject", label: "Remove", Icon: IconTrash, multi: true },
];

const HOVER_ACTIONS: { action: RecentAction; title: string; Icon: (props: { width?: number; height?: number }) => React.JSX.Element }[] = [
  { action: "openInNewWindow", title: "Open in New Window", Icon: IconLinkExternal },
  { action: "openInCurrentWindow", title: "Open in Current Window", Icon: IconOpenInProduct },
  { action: "addFavorite", title: "Add to Favorites", Icon: IconStarEmpty },
  { action: "removeProject", title: "Remove", Icon: IconTrash },
];

interface MenuState {
  x: number;
  y: number;
  targetId: string;
}

export function RecentApp() {
  const items = useRecentStore((s) => s.items);
  const loading = useRecentStore((s) => s.loading);
  const clickMode = useRecentStore((s) => s.clickMode);
  const selectedIds = useRecentStore((s) => s.selectedIds);
  const focusedId = useRecentStore((s) => s.focusedId);

  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // 双击模式的 pending 状态（ref，避免重渲染）。
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingClickIdRef = useRef<string | null>(null);

  // 初始化：拉数据 + openMode（事件订阅在 store 模块级注册）
  useEffect(() => {
    void useRecentStore.getState().init();
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  const handleItemClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      const store = useRecentStore.getState();
      if (e.ctrlKey || e.metaKey) {
        store.toggleSelect(id);
        return;
      }
      if (e.shiftKey) {
        store.rangeSelectTo(id);
        return;
      }
      // 普通点击：先选中，再按 clickMode 决定是否打开
      store.selectSingle(id);
      if (clickMode === "singleClick") {
        void store.open(id);
      } else {
        // 双击模式：400ms 内同一 id 第二次点击 → 打开
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        if (pendingClickIdRef.current === id) {
          pendingClickIdRef.current = null;
          void store.open(id);
        } else {
          pendingClickIdRef.current = id;
          clickTimerRef.current = setTimeout(() => {
            pendingClickIdRef.current = null;
            clickTimerRef.current = null;
          }, 400);
        }
      }
    },
    [clickMode],
  );

  const runAction = useCallback((action: RecentAction, ids: string[]) => {
    void useRecentStore.getState().executeAction(action, ids);
    setMenu(null);
  }, []);

  // 右键菜单
  const onContextMenu = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      const store = useRecentStore.getState();
      // 右键的项若不在选择集里，则单选它（与 legacy 一致）
      if (!store.selectedIds.has(id)) {
        store.selectSingle(id);
      }
      // 视口边缘吸附交给 useClampedPosition（渲染后测量实际尺寸）
      setMenu({ x: e.clientX, y: e.clientY, targetId: id });
    },
    [],
  );

  // 点击空白 / 失焦 → 清选择 + 关菜单
  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Element;
      if (target.closest(".context-menu")) return;
      if (!target.closest(".recent-item")) {
        useRecentStore.getState().clearSelection();
      }
      setMenu(null);
    };
    // 空白处右键：阻止 webview 原生菜单（Reload/Inspect），与 legacy contextMenuScript 一致
    const onDocContextmenu = (e: MouseEvent): void => {
      const target = e.target as Element;
      if (target.closest(".recent-item") || target.closest(".context-menu")) return;
      e.preventDefault();
    };
    const onBlur = (): void => {
      useRecentStore.getState().clearSelection();
      setMenu(null);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("contextmenu", onDocContextmenu);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("contextmenu", onDocContextmenu);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // 框选（handlers 用 ref 包裹避免 effect 频繁重建 —— 这里 store 是稳定的，
  // 直接用 getState，无需依赖 handlers 引用）
  useRubberBand(listRef, ".recent-item", {
    onSelection: (ids, modifiers) => {
      const store = useRecentStore.getState();
      if (modifiers.ctrl) store.toggleSelectionFromRect(ids);
      else if (modifiers.shift) store.addSelectionFromRect(ids);
      else store.setSelectionFromRect(ids);
    },
    onEmptyClick: (modifiers) => {
      if (!modifiers.ctrl && !modifiers.shift) {
        useRecentStore.getState().clearSelection();
      }
    },
  });

  if (loading && items.length === 0) {
    return <div className="recent-loading">{t("Loading...")}</div>;
  }

  return (
    <>
      <div className="recent-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="recent-empty">{t("No recent projects")}</div>
        ) : (
          items.map((p) => (
            <ProjectRow
              key={p.id}
              item={p}
              selected={selectedIds.has(p.id)}
              focused={focusedId === p.id}
              onClick={(e) => handleItemClick(p.id, e)}
              onContextMenu={(e) => onContextMenu(p.id, e)}
              onHoverAction={(action) => runAction(action, [p.id])}
            />
          ))
        )}
      </div>
      {menu && (
        <RecentContextMenu
          menu={menu}
          multiSelect={selectedIds.size > 1}
          onClose={() => setMenu(null)}
          onAction={(action) => {
            const ids = selectedIds.size > 0 ? [...selectedIds] : [menu.targetId];
            runAction(action, ids);
          }}
        />
      )}
    </>
  );
}

function ProjectRow({
  item,
  selected,
  focused,
  onClick,
  onContextMenu,
  onHoverAction,
}: {
  item: RecentItemDto;
  selected: boolean;
  focused: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onHoverAction: (action: RecentAction) => void;
}) {
  const className = [
    "recent-item",
    item.isValid ? "" : "invalid",
    focused ? "focused" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      data-id={item.id}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={item.path}
    >
      <span className="recent-item-icon">
        <ProjectIcon icon={item.icon} iconSource={item.iconSource} size={20} />
      </span>
      <div className="recent-item-content">
        <div className="recent-item-label-row">
          <span className="recent-item-label">{item.name}</span>
          <span className="recent-item-desc">{item.timeLabel}</span>
        </div>
        <div className="recent-item-path-row">
          <span className="recent-item-path">{item.path}</span>
          <div className="recent-item-hover-actions">
            {HOVER_ACTIONS.map(({ action, title, Icon }) => (
              <button
                key={action}
                type="button"
                className="recent-hover-btn"
                title={t(title)}
                onClick={(e) => {
                  e.stopPropagation();
                  onHoverAction(action);
                }}
              >
                <Icon width={13} height={13} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentContextMenu({
  menu,
  multiSelect,
  onAction,
  onClose,
}: {
  menu: MenuState;
  multiSelect: boolean;
  onAction: (action: RecentAction) => void;
  onClose: () => void;
}) {
  const items: ContextMenuEntry[] = PROJECT_MENU.map((mi, idx) =>
    "sep" in mi
      ? { key: `sep-${idx}`, separator: true }
      : {
          key: mi.action,
          label: t(mi.label),
          icon: mi.Icon,
          disabled: multiSelect && !mi.multi,
          onSelect: () => onAction(mi.action),
        },
  );
  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />;
}
