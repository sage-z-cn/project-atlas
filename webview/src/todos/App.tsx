import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../shared/i18n";
import { useTodoStore } from "../shared/store/todo-store";
import type { TodoItemDto, TodoScope, TodoTag, WorkspaceFolderInfo } from "../shared/types/todo";
import { ContextMenu, type ContextMenuEntry } from "../shared/components/ContextMenu";
import IconChevronDown from "~icons/codicon/chevron-down";
import IconChevronRight from "~icons/codicon/chevron-right";
import IconPlus from "~icons/codicon/add";
import IconTrash from "~icons/codicon/trash";
import IconCopy from "~icons/codicon/copy";
import IconEdit from "~icons/codicon/edit";
import IconCheck from "~icons/codicon/check";
import IconGoToFile from "~icons/codicon/go-to-file";
import IconLoading from "~icons/codicon/loading";
import "./todos.css";

/** tag → 色块背景色。 */
const TAG_COLOR: Record<TodoTag, string> = {
  TODO: "#3794ff",
  FIXME: "#f14c4c",
  XXX: "#e2a73d",
  HACK: "#b074d9",
  BUG: "#f14c4c",
  NOTE: "#73c991",
};

const SCAN_TAG_ORDER: TodoTag[] = ["TODO", "FIXME", "XXX", "HACK", "BUG", "NOTE"];

/** 模块级拖拽 id / workspaceId 跟踪（跨行读取，比 per-row ref 可靠）。 */
let dragTodoId: string | null = null;
let dragTodoWsId: string | null = null;

/** 时间戳 → MM-DD。 */
function formatMonthDay(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}`;
}

interface TodoMenu {
  x: number;
  y: number;
  item: TodoItemDto;
  type: "manual" | "scan";
  onEdit?: () => void;
}

export default function TodosApp(): React.JSX.Element {
  const globalManual = useTodoStore((s) => s.globalManual);
  const projectManual = useTodoStore((s) => s.projectManual);
  const scanned = useTodoStore((s) => s.scanned);
  const scanning = useTodoStore((s) => s.scanning);
  const loading = useTodoStore((s) => s.loading);
  const [menu, setMenu] = useState<TodoMenu | null>(null);
  const selectedId = menu?.item.id ?? null;

  useEffect(() => {
    void useTodoStore.getState().init();
  }, []);

  return (
    <>
      <div className="todos-root">
        <AddTodoInput />
        {loading ? (
          <div className="todos-loading">
            <IconLoading width={16} height={16} className="todos-spin" />
          </div>
        ) : (
          <div className="todos-list">
            <TodoSection
              title={t("Global")}
              items={globalManual}
              type="manual"
              scope="global"
              selectedId={selectedId}
              setMenu={setMenu}
            />
            <TodoSection
              title={t("Project")}
              items={projectManual}
              type="manual"
              scope="project"
              selectedId={selectedId}
              setMenu={setMenu}
            />
            <TodoSection
              title={t("Scanned")}
              items={scanned}
              type="scan"
              scanning={scanning}
              selectedId={selectedId}
              setMenu={setMenu}
            />
          </div>
        )}
      </div>
      {menu && <TodoContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

function AddTodoInput(): React.JSX.Element {
  const workspaceFolders = useTodoStore((s) => s.workspaceFolders);
  const [scope, setScope] = useState<TodoScope>("project");
  const [tag, setTag] = useState<TodoTag>("TODO");
  const [text, setText] = useState("");
  const [folderUri, setFolderUri] = useState<string>("");

  useEffect(() => {
    if (workspaceFolders.length > 0 && !folderUri) {
      setFolderUri(workspaceFolders[0].uri);
    }
  }, [workspaceFolders, folderUri]);

  const submit = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const input: {
      scope: TodoScope;
      text: string;
      tag?: TodoTag;
      workspaceId?: string;
    } = { scope, text: trimmed, tag };
    if (scope === "project" && folderUri) input.workspaceId = folderUri;
    setText("");
    await useTodoStore.getState().add(input);
  };

  return (
    <div className="todos-add">
      <div className="todos-controls">
        <div className="todos-segmented">
          <button
            type="button"
            className={`todos-seg-btn${scope === "global" ? " active" : ""}`}
            onClick={() => setScope("global")}
          >
            {t("Global")}
          </button>
          <button
            type="button"
            className={`todos-seg-btn${scope === "project" ? " active" : ""}`}
            onClick={() => setScope("project")}
          >
            {t("Project")}
          </button>
        </div>
        <select
          className="todos-select"
          value={tag}
          onChange={(e) => setTag(e.target.value as TodoTag)}
        >
          {SCAN_TAG_ORDER.map((tg) => (
            <option key={tg} value={tg}>
              {tg}
            </option>
          ))}
        </select>
        {scope === "project" && workspaceFolders.length > 1 && (
          <select
            className="todos-select"
            value={folderUri}
            onChange={(e) => setFolderUri(e.target.value)}
          >
            {workspaceFolders.map((f) => (
              <option key={f.uri} value={f.uri}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="todos-input-group">
        <input
          className="todos-text-input"
          type="text"
          placeholder={t("Add TODO...")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          className="todos-add-btn"
          onClick={() => void submit()}
        >
          <IconPlus width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function TodoSection({
  title,
  items,
  type,
  scope,
  scanning,
  selectedId,
  setMenu,
}: {
  title: string;
  items: TodoItemDto[];
  type: "manual" | "scan";
  scope?: TodoScope;
  scanning?: boolean;
  selectedId: string | null;
  setMenu: (menu: TodoMenu) => void;
}): React.JSX.Element {
  const expandedGroups = useTodoStore((s) => s.expandedGroups);
  const workspaceFolders = useTodoStore((s) => s.workspaceFolders);
  const key = type === "scan" ? "scan-root" : scope!;
  const expanded = expandedGroups.has(key);

  return (
    <div className="todos-section">
      <div
        className="todos-section-header"
        onClick={() => useTodoStore.getState().toggleGroup(key)}
      >
        <span className="todos-chevron">
          {expanded ? (
            <IconChevronDown width={16} height={16} />
          ) : (
            <IconChevronRight width={16} height={16} />
          )}
        </span>
        <span className="todos-section-title">
          {title}
          {type === "scan" && scanning ? (
            <IconLoading width={14} height={14} className="todos-spin" style={{ marginLeft: 6 }} />
          ) : null}
        </span>
        <span className="todos-count">{items.length}</span>
      </div>
      {expanded && (
        <div className="todos-section-body">
          {items.length === 0 ? (
            <div className="todos-empty">{t("No TODOs")}</div>
          ) : type === "manual" && scope === "project" ? (
            <ProjectRepoGroups
              items={items}
              workspaceFolders={workspaceFolders}
              rootUri={workspaceFolders[0]?.uri ?? ""}
              selectedId={selectedId}
              setMenu={setMenu}
            />
          ) : type === "manual" ? (
            items.map((it) => (
              <TodoManualRow
                key={it.id}
                item={it}
                scope={scope!}
                selectedId={selectedId}
                setMenu={setMenu}
              />
            ))
          ) : (
            <ScanTagGroups items={items} selectedId={selectedId} setMenu={setMenu} />
          )}
        </div>
      )}
    </div>
  );
}

/** scan 段按 tag 子分组渲染。 */
function ScanTagGroups({
  items,
  selectedId,
  setMenu,
}: {
  items: TodoItemDto[];
  selectedId: string | null;
  setMenu: (menu: TodoMenu) => void;
}): React.JSX.Element {
  const grouped = useMemo(() => {
    const map = new Map<TodoTag, TodoItemDto[]>();
    for (const it of items) {
      const tag = (it.tag ?? "TODO") as TodoTag;
      const arr = map.get(tag);
      if (arr) arr.push(it);
      else map.set(tag, [it]);
    }
    return map;
  }, [items]);

  const expandedGroups = useTodoStore((s) => s.expandedGroups);

  return (
    <>
      {SCAN_TAG_ORDER.filter((tag) => grouped.has(tag)).map((tag) => {
        const groupKey = `scan:${tag}`;
        const expanded = expandedGroups.has(groupKey);
        const list = grouped.get(tag)!;
        return (
          <div key={tag} className="todos-scan-tag">
            <div
              className="todos-scan-tag-header"
              onClick={() => useTodoStore.getState().toggleGroup(groupKey)}
            >
              <span className="todos-chevron">
                {expanded ? (
                  <IconChevronDown width={14} height={14} />
                ) : (
                  <IconChevronRight width={14} height={14} />
                )}
              </span>
              <span
                className="todos-tag-badge"
                style={{ backgroundColor: TAG_COLOR[tag] }}
              >
                {tag}
              </span>
              <span className="todos-count">{list.length}</span>
            </div>
            {expanded && (
              <div>
                {list.map((it) => (
                  <TodoScanRow key={it.id} item={it} selectedId={selectedId} setMenu={setMenu} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** project 段按 workspaceId（repo）子分组渲染。 */
function ProjectRepoGroups({
  items,
  workspaceFolders,
  rootUri,
  selectedId,
  setMenu,
}: {
  items: TodoItemDto[];
  workspaceFolders: WorkspaceFolderInfo[];
  rootUri: string;
  selectedId: string | null;
  setMenu: (menu: TodoMenu) => void;
}): React.JSX.Element {
  const expandedGroups = useTodoStore((s) => s.expandedGroups);

  // 根目录（整个工作区）的 TODO 直接平铺，子 repo 的按 repo 分组
  const rootItems = items.filter((it) => (it.workspaceId ?? "") === rootUri);
  const subItems = items.filter((it) => (it.workspaceId ?? "") !== rootUri);

  const grouped = useMemo(() => {
    const map = new Map<string, TodoItemDto[]>();
    for (const it of subItems) {
      const wsId = it.workspaceId ?? "";
      const arr = map.get(wsId);
      if (arr) arr.push(it);
      else map.set(wsId, [it]);
    }
    return map;
  }, [subItems]);

  const nameFor = (uri: string): string => {
    const f = workspaceFolders.find((wf) => wf.uri === uri);
    return f?.name ?? uri;
  };

  return (
    <>
      {rootItems.map((it) => (
        <TodoManualRow
          key={it.id}
          item={it}
          scope="project"
          selectedId={selectedId}
          setMenu={setMenu}
        />
      ))}
      {[...grouped.entries()].map(([wsId, list]) => {
        const groupKey = `project:${wsId}`;
        const expanded = expandedGroups.has(groupKey);
        return (
          <div key={wsId} className="todos-project-repo">
            <div
              className="todos-project-repo-header"
              onClick={() => useTodoStore.getState().toggleGroup(groupKey)}
            >
              <span className="todos-chevron">
                {expanded ? (
                  <IconChevronDown width={14} height={14} />
                ) : (
                  <IconChevronRight width={14} height={14} />
                )}
              </span>
              <span className="todos-repo-name">{nameFor(wsId)}</span>
              <span className="todos-count">{list.length}</span>
            </div>
            {expanded && (
              <div>
                {list.map((it) => (
                  <TodoManualRow
                    key={it.id}
                    item={it}
                    scope="project"
                    selectedId={selectedId}
                    setMenu={setMenu}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** DnD 落点指示器位置。 */
type DropPos = "before" | "after" | null;

function TodoManualRow({
  item,
  scope,
  selectedId,
  setMenu,
}: {
  item: TodoItemDto;
  scope: TodoScope;
  selectedId: string | null;
  setMenu: (menu: TodoMenu) => void;
}): React.JSX.Element {
  const [dropPos, setDropPos] = useState<DropPos>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [copied, setCopied] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [editing]);

  const completed = item.status === "completed";
  const selected = selectedId === item.id;
  const wsId = item.workspaceId ?? null;

  const tooltipParts: string[] = [];
  if (item.createdAt) tooltipParts.push(`${t("Created")}: ${formatMonthDay(item.createdAt)}`);
  if (completed && item.completedAt) tooltipParts.push(`${t("Completed")}: ${formatMonthDay(item.completedAt)}`);

  const commitEdit = (): void => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.text) {
      void useTodoStore.getState().update(item.id, { text: trimmed });
    }
    setEditing(false);
  };

  const startEdit = (): void => {
    setDraft(item.text);
    setEditing(true);
  };

  return (
    <div
      className={`todos-manual-row${completed ? " completed" : ""}${
        dropPos ? " drag-over" : ""
      }${selected ? " selected" : ""}`}
      title={tooltipParts.length > 0 ? tooltipParts.join("\n") : undefined}
      onDoubleClick={() => {
        if (!editing) startEdit();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, item, type: "manual", onEdit: startEdit });
      }}
      draggable={!editing}
      onDragStart={(e) => {
        dragTodoId = item.id;
        dragTodoWsId = wsId;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        (e.currentTarget as HTMLElement).style.opacity = "0.5";
      }}
      onDragEnd={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = "";
        setDropPos(null);
        dragTodoId = null;
        dragTodoWsId = null;
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragTodoId || dragTodoId === item.id) return;
        if (dragTodoWsId !== wsId) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos: DropPos =
          e.clientY - rect.top < rect.height / 2 ? "before" : "after";
        setDropPos(pos);
      }}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        e.preventDefault();
        const dragId = dragTodoId ?? e.dataTransfer.getData("text/plain");
        if (dragId && dragId !== item.id && dropPos && dragTodoWsId === wsId) {
          const list =
            scope === "global"
              ? useTodoStore.getState().globalManual
              : useTodoStore.getState().projectManual.filter(
                  (it) => (it.workspaceId ?? "") === (wsId ?? ""),
                );
          const ids = list.map((it) => it.id);
          const fromIdx = ids.indexOf(dragId);
          if (fromIdx === -1) {
            setDropPos(null);
            return;
          }
          ids.splice(fromIdx, 1);
          let toIdx = ids.indexOf(item.id);
          if (toIdx === -1) {
            setDropPos(null);
            return;
          }
          if (dropPos === "after") toIdx += 1;
          ids.splice(toIdx, 0, dragId);
          void useTodoStore.getState().reorder(scope, ids, item.workspaceId);
        }
        setDropPos(null);
      }}
    >
      {dropPos === "before" && <div className="todos-drop-indicator before" />}
      <input
        type="checkbox"
        className="todos-checkbox"
        checked={completed}
        onChange={() => void useTodoStore.getState().toggle(item.id)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {item.tag && (
        <span
          className="todos-tag-badge"
          style={{ backgroundColor: TAG_COLOR[item.tag] }}
        >
          {item.tag}
        </span>
      )}
      {editing ? (
        <input
          ref={editRef}
          className="todos-edit-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(item.text);
              setEditing(false);
            }
          }}
          onBlur={() => {
            setDraft(item.text);
            setEditing(false);
          }}
        />
      ) : (
        <span className="todos-text">
          {item.text}
        </span>
      )}
      <span className="todos-actions" onDoubleClick={(e) => e.stopPropagation()}>
        {copied && <span className="todos-copied">{t("Copied")}</span>}
        <button
          type="button"
          className="todos-action-btn"
          title={t("Copy")}
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(item.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch (err) {
              console.error("copy failed:", err);
            }
          }}
        >
          <IconCopy width={13} height={13} />
        </button>
        <button
          type="button"
          className="todos-action-btn"
          title={t("Edit")}
          onClick={(e) => {
            e.stopPropagation();
            if (editing) {
              setDraft(item.text);
              setEditing(false);
            } else {
              startEdit();
            }
          }}
        >
          <IconEdit width={13} height={13} />
        </button>
        <button
          type="button"
          className="todos-action-btn todos-delete-btn"
          title={t("Delete")}
          onClick={(e) => {
            e.stopPropagation();
            void useTodoStore.getState().remove(item.id);
          }}
        >
          <IconTrash width={13} height={13} />
        </button>
      </span>
      {dropPos === "after" && <div className="todos-drop-indicator after" />}
    </div>
  );
}

function TodoScanRow({
  item,
  selectedId,
  setMenu,
}: {
  item: TodoItemDto;
  selectedId: string | null;
  setMenu: (menu: TodoMenu) => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const selected = selectedId === item.id;

  return (
    <div
      className={`todos-scan-row${selected ? " selected" : ""}`}
      onClick={() => void useTodoStore.getState().jumpTo(item.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, item, type: "scan" });
      }}
      title={item.file ?? item.relativePath}
    >
      {item.tag && (
        <span
          className="todos-tag-badge"
          style={{ backgroundColor: TAG_COLOR[item.tag] }}
        >
          {item.tag}
        </span>
      )}
      <span className="todos-scan-text">{item.text}</span>
      {item.assignee && <span className="todos-assignee">({item.assignee})</span>}
      <span className="todos-scan-path">
        {item.relativePath ?? ""}
        {item.line != null ? `:${item.line}` : ""}
      </span>
      <span className="todos-actions">
        {copied && <span className="todos-copied">{t("Copied")}</span>}
        <button
          type="button"
          className="todos-action-btn"
          title={t("Copy")}
          onClick={async (e) => {
            e.stopPropagation();
            const copyText = `${item.relativePath ?? ""}:${item.line ?? ""}  ${item.text}`;
            try {
              await navigator.clipboard.writeText(copyText);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch (err) {
              console.error("copy failed:", err);
            }
          }}
        >
          <IconCopy width={13} height={13} />
        </button>
      </span>
    </div>
  );
}

function TodoContextMenu({
  menu,
  onClose,
}: {
  menu: TodoMenu;
  onClose: () => void;
}): React.JSX.Element {
  const { item, type, onEdit } = menu;
  const store = useTodoStore.getState();
  const completed = item.status === "completed";

  const copyText =
    type === "scan"
      ? `${item.relativePath ?? ""}:${item.line ?? ""}  ${item.text}`
      : item.text;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyText);
    } catch (err) {
      console.error("copy failed:", err);
    }
  };

  const items: ContextMenuEntry[] =
    type === "scan"
      ? [
          {
            key: "jump",
            label: t("Jump to Source"),
            icon: IconGoToFile,
            onSelect: () => void store.jumpTo(item.id),
          },
          { key: "sep1", separator: true },
          { key: "copy", label: t("Copy"), icon: IconCopy, onSelect: () => void handleCopy() },
        ]
      : [
          {
            key: "toggle",
            label: completed ? t("Mark as Incomplete") : t("Mark as Complete"),
            icon: IconCheck,
            onSelect: () => void store.toggle(item.id),
          },
          { key: "sep1", separator: true },
          { key: "copy", label: t("Copy"), icon: IconCopy, onSelect: () => void handleCopy() },
          { key: "edit", label: t("Edit"), icon: IconEdit, onSelect: () => onEdit?.() },
          { key: "sep2", separator: true },
          {
            key: "delete",
            label: t("Delete"),
            icon: IconTrash,
            onSelect: () => void store.remove(item.id),
          },
        ];

  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />;
}
