import { useEffect, useRef, useState } from "react";
import { t } from "../shared/i18n";
import { bridge } from "../shared/bridge";
import { ContextMenu, type ContextMenuEntry } from "../shared/components/ContextMenu";
import { ProjectIcon } from "../shared/components/ProjectIcon";
import { useFavoritesStore, type TreeNodeDto, type FavoriteAction } from "../shared/store/favorites-store";
import IconChevronDown from "~icons/codicon/chevron-down";
import IconChevronRight from "~icons/codicon/chevron-right";
import IconFolder from "~icons/codicon/folder";
import IconFolderOpened from "~icons/codicon/folder-opened";
import IconLinkExternal from "~icons/codicon/link-external";
import IconOpenInProduct from "~icons/codicon/open-in-product";
import IconClose from "~icons/codicon/close";
import IconCopy from "~icons/codicon/copy";
import IconEdit from "~icons/codicon/edit";
import IconNewFolder from "~icons/codicon/new-folder";
import IconTrash from "~icons/codicon/trash";
import "./favorites.css";

type IconComp = (props: { width?: number; height?: number }) => React.JSX.Element;

interface ProjectMenuItem {
  action: FavoriteAction;
  label: string;
  Icon: IconComp;
  multi?: boolean;
}
interface GroupMenuItem {
  action: "addSubGroup" | "renameGroup" | "deleteGroup";
  label: string;
  Icon: IconComp;
  multi?: boolean;
}

const PROJECT_MENU: ProjectMenuItem[] = [
  { action: "openFavoriteInNewWindow", label: "Open in New Window", Icon: IconLinkExternal },
  { action: "openFavoriteInCurrentWindow", label: "Open in Current Window", Icon: IconOpenInProduct },
  { action: "revealFavoriteInExplorer", label: "Reveal in File Explorer", Icon: IconFolder },
  { action: "copyFavoritePath", label: "Copy Path", Icon: IconCopy },
  { action: "renameFavorite", label: "Rename", Icon: IconEdit },
  { action: "removeFavorite", label: "Remove from Favorites", Icon: IconClose, multi: true },
];
const GROUP_MENU: GroupMenuItem[] = [
  { action: "addSubGroup", label: "Create Sub-group", Icon: IconNewFolder },
  { action: "renameGroup", label: "Rename Group", Icon: IconEdit },
  { action: "deleteGroup", label: "Delete Group", Icon: IconTrash, multi: true },
];

interface MenuState {
  x: number;
  y: number;
  node: TreeNodeDto;
}
interface DropTarget {
  id: string;
  position: "before" | "after" | "inside";
}

export function FavoritesApp() {
  const tree = useFavoritesStore((s) => s.tree);
  const loading = useFavoritesStore((s) => s.loading);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useFavoritesStore.getState().init();
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Element;
      if (target.closest(".context-menu")) return;
      if (!target.closest(".fav-node")) useFavoritesStore.getState().clearSelection();
      setMenu(null);
    };
    // 空白处右键：阻止 webview 原生菜单
    const onDocContextmenu = (e: MouseEvent): void => {
      const target = e.target as Element;
      if (target.closest(".fav-node") || target.closest(".context-menu")) return;
      e.preventDefault();
    };
    const onBlur = (): void => {
      useFavoritesStore.getState().clearSelection();
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

  if (loading && tree.length === 0) {
    return <div className="fav-empty">{t("Loading...")}</div>;
  }
  if (tree.length === 0) {
    return <div className="fav-empty">{t("No favorites yet")}</div>;
  }

  return (
    <>
      <div className="fav-tree" ref={listRef}>
        {tree.map((node) => (
          <TreeNode key={node.id} node={node} depth={0} setMenu={setMenu} />
        ))}
      </div>
      {menu && <FavoritesContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

/** 收集当前展开状态下可见的节点 id（Shift 范围选择用）。 */
function collectVisibleIds(
  nodes: TreeNodeDto[],
  expanded: Set<string>,
  acc: string[],
): void {
  for (const n of nodes) {
    acc.push(n.id);
    if (n.type === "group" && expanded.has(n.id) && n.children) {
      collectVisibleIds(n.children, expanded, acc);
    }
  }
}

function TreeNode({
  node,
  depth,
  setMenu,
}: {
  node: TreeNodeDto;
  depth: number;
  setMenu: (m: MenuState | null) => void;
}) {
  const expanded = useFavoritesStore((s) => s.expanded);
  const selectedIds = useFavoritesStore((s) => s.selectedIds);
  const focusedId = useFavoritesStore((s) => s.focusedId);
  const clickMode = useFavoritesStore((s) => s.clickMode);

  const isGroup = node.type === "group";
  const isExpanded = expanded.has(node.id);
  const isFocused = focusedId === node.id;
  const isSelected = selectedIds.has(node.id) && !isFocused;
  const invalid = !isGroup && node.isValid === false;

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingClickRef = useRef<string | null>(null);

  // DnD：当前节点作为落点的视觉态
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // 拖拽源存模块级 dragState（跨节点共享，见文件末）

  const indentWidth = isGroup ? depth * 16 : (depth + 1) * 16;

  const onClick = (e: React.MouseEvent): void => {
    const store = useFavoritesStore.getState();
    if (e.ctrlKey || e.metaKey) {
      store.toggleSelect(node.id);
      return;
    }
    if (e.shiftKey) {
      const visibleIds: string[] = [];
      collectVisibleIds(store.tree, store.expanded, visibleIds);
      store.rangeSelectTo(node.id, visibleIds);
      return;
    }
    store.selectSingle(node.id);
    if (isGroup) {
      store.toggleExpand(node.id);
      return;
    }
    // project
    if (clickMode === "singleClick") {
      void store.open(node.id);
    } else {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      if (pendingClickRef.current === node.id) {
        pendingClickRef.current = null;
        void store.open(node.id);
      } else {
        pendingClickRef.current = node.id;
        clickTimerRef.current = setTimeout(() => {
          pendingClickRef.current = null;
          clickTimerRef.current = null;
        }, 400);
      }
    }
  };

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const store = useFavoritesStore.getState();
    if (!store.selectedIds.has(node.id)) store.selectSingle(node.id);
    // 视口边缘吸附交给 useClampedPosition
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  // ── DnD handlers ──
  const onDragStart = (e: React.DragEvent): void => {
    dragState.drag = { id: node.id, type: node.type };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
    (e.currentTarget as HTMLElement).style.opacity = "0.5";
  };
  const onDragEnd = (e: React.DragEvent): void => {
    (e.currentTarget as HTMLElement).style.opacity = "";
    setDropTarget(null);
    dragState.drag = null;
  };
  const onDragOver = (e: React.DragEvent): void => {
    if (!dragState.drag) return;
    if (dragState.drag.id === node.id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let position: DropTarget["position"];
    if (isGroup) {
      if (y < h * 0.25) position = "before";
      else if (y > h * 0.75) position = "after";
      else position = "inside";
    } else {
      position = y < h / 2 ? "before" : "after";
    }
    // 防嵌套：group/project 不能 inside project（project 无 inside 语义已保证）
    setDropTarget({ id: node.id, position });
  };
  const onDragLeave = (): void => {
    setDropTarget((cur) => (cur?.id === node.id ? null : cur));
  };
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragState.drag || !dropTarget) {
      setDropTarget(null);
      return;
    }
    void useFavoritesStore.getState().dropNode(dragState.drag, { id: node.id, type: node.type }, dropTarget.position);
    setDropTarget(null);
    dragState.drag = null;
  };

  const className = [
    "fav-node",
    isGroup ? "" : "is-project",
    invalid ? "invalid" : "",
    isFocused ? "focused" : "",
    isSelected ? "selected" : "",
    dropTarget?.position === "inside" ? "drag-over-inside" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const showBeforeIndicator = dropTarget?.id === node.id && dropTarget.position === "before";
  const showAfterIndicator = dropTarget?.id === node.id && dropTarget.position === "after";

  return (
    <>
      <div
        className={className}
        data-id={node.id}
        data-type={node.type}
        draggable
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        title={isGroup ? node.name : node.path ?? node.name}
      >
        {showBeforeIndicator && <div className="fav-drop-indicator before" />}
        {indentWidth > 0 && (
          <div className="fav-indent" style={{ width: indentWidth }}>
            {Array.from({ length: depth }, (_, i) => (
              <div key={i} className="fav-indent-guide" style={{ left: i * 16 + 8 }} />
            ))}
          </div>
        )}
        {isGroup && (
          <span className="fav-chevron">
            {isExpanded ? <IconChevronDown width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
          </span>
        )}
        <span className="fav-icon">
          {isGroup ? (
            isExpanded ? <IconFolderOpened width={20} height={20} /> : <IconFolder width={20} height={20} />
          ) : (
            <ProjectIcon icon={node.icon ?? "vscode"} iconSource={node.iconSource ?? "codicon"} size={20} />
          )}
        </span>
        <div className="fav-content">
          <span className="fav-label">{node.name}</span>
          {!isGroup && node.path && (
            <div className="fav-path-row">
              <span className="fav-path">{node.path}</span>
              <div className="fav-hover-actions">
                <HoverBtn title="Open in New Window" Icon={IconLinkExternal} action="openFavoriteInNewWindow" id={node.id} />
                <HoverBtn title="Open in Current Window" Icon={IconOpenInProduct} action="openFavoriteInCurrentWindow" id={node.id} />
                <HoverBtn title="Remove from Favorites" Icon={IconClose} action="removeFavorite" id={node.id} />
              </div>
            </div>
          )}
        </div>
        {showAfterIndicator && <div className="fav-drop-indicator after" />}
      </div>
      {isGroup && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} setMenu={setMenu} />
          ))}
        </div>
      )}
    </>
  );
}

// 模块级 DnD 拖拽源（跨节点共享，dragstart 设置，drop/dragend 清空）
const dragState: { drag: { id: string; type: string } | null } = { drag: null };

function HoverBtn({
  title,
  Icon,
  action,
  id,
}: {
  title: string;
  Icon: IconComp;
  action: FavoriteAction;
  id: string;
}) {
  return (
    <button
      type="button"
      className="fav-hover-btn"
      title={t(title)}
      onClick={(e) => {
        e.stopPropagation();
        const ids = [id];
        void useFavoritesStore.getState().executeProjectAction(action, ids);
      }}
    >
      <Icon width={13} height={13} />
    </button>
  );
}

function FavoritesContextMenu({
  menu,
  onClose,
}: {
  menu: MenuState;
  onClose: () => void;
}) {
  const { node } = menu;
  const selectedIds = useFavoritesStore.getState().selectedIds;
  const multiSelect = selectedIds.size > 1;

  const menuDef = node.type === "group" ? GROUP_MENU : PROJECT_MENU;
  const ids = selectedIds.size > 0 ? [...selectedIds] : [node.id];

  const items: ContextMenuEntry[] = menuDef.map((mi) => ({
    key: mi.action,
    label: t(mi.label),
    icon: mi.Icon,
    disabled: multiSelect && !mi.multi,
    onSelect: () => {
      if (node.type === "group") {
        const action = mi.action as "addSubGroup" | "renameGroup" | "deleteGroup";
        bridge
          .request(action, action === "addSubGroup" ? { id: node.id } : { ids })
          .catch((err) => console.error(`${action} failed:`, err));
      } else {
        void useFavoritesStore
          .getState()
          .executeProjectAction(mi.action as FavoriteAction, ids);
      }
    },
  }));

  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />;
}
