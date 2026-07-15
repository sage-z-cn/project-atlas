import { useEffect, useRef, useState } from "react";
import { t } from "../shared/i18n";
import { ContextMenu, type ContextMenuEntry } from "../shared/components/ContextMenu";
import { useTaskStore, type TaskItemDto } from "../shared/store/task-store";
import IconNpm from "~icons/devicon/npm";
import IconTerminal from "~icons/codicon/terminal";
import IconPlay from "~icons/codicon/play";
import IconStop from "~icons/codicon/debug-stop";
import IconPin from "~icons/codicon/pin";
import IconPinned from "~icons/codicon/pinned";
import IconClose from "~icons/codicon/close";
import IconHistory from "~icons/codicon/history";
import IconFolder from "~icons/codicon/folder";
import IconFolderOpened from "~icons/codicon/folder-opened";
import IconChevronDown from "~icons/codicon/chevron-down";
import IconChevronRight from "~icons/codicon/chevron-right";
import IconLoading from "~icons/codicon/loading";
import "./tasks.css";

export function TasksApp() {
  const pinnedItems = useTaskStore((s) => s.pinnedItems);
  const recentItems = useTaskStore((s) => s.recentItems);
  const rootProject = useTaskStore((s) => s.rootProject);
  const projects = useTaskStore((s) => s.projects);
  const loading = useTaskStore((s) => s.loading);
  const expandedProjects = useTaskStore((s) => s.expandedProjects);
  const expandedPinned = useTaskStore((s) => s.expandedPinned);
  const expandedRecent = useTaskStore((s) => s.expandedRecent);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    task: TaskItemDto;
    inRecent: boolean;
  } | null>(null);

  useEffect(() => {
    void useTaskStore.getState().init();
    const onDocClick = (): void => setMenu(null);
    // 空白处右键：阻止 webview 原生菜单
    const onDocContextmenu = (e: MouseEvent): void => {
      const target = e.target as Element;
      if (target.closest(".tasks-item") || target.closest(".context-menu")) return;
      e.preventDefault();
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("contextmenu", onDocContextmenu);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("contextmenu", onDocContextmenu);
    };
  }, []);

  const hasSubProjects = projects.length > 0;
  const rootLabel = useTaskStore((s) => s.workspaceName);
  const hasContent =
    pinnedItems.length > 0 ||
    recentItems.length > 0 ||
    rootProject.tasks.length > 0 ||
    projects.length > 0;

  if (loading && !hasContent) {
    return (
      <div className="tasks-loading">
        <IconLoading width={16} height={16} className="tasks-spin" />
        <span>{t("Loading tasks...")}</span>
      </div>
    );
  }

  return (
    <>
      <div className="tasks-list">
        {!hasContent ? (
          <div className="tasks-empty">{t("No tasks found")}</div>
        ) : (
          <>
            {pinnedItems.length > 0 && (
              <>
                <TaskSection
                  headerLabel={t("Pinned")}
                  expanded={expandedPinned}
                  onToggle={() => useTaskStore.getState().togglePinned()}
                  headerIcon={<IconPinned width={16} height={16} />}
                  tasks={pinnedItems}
                  showPath
                  setMenu={setMenu}
                />
                {(recentItems.length > 0 || hasSubProjects || rootProject.tasks.length > 0) && (
                  <div className="tasks-separator" />
                )}
              </>
            )}

            {recentItems.length > 0 && (
              <>
                <TaskSection
                  headerLabel={t("Recent Runs")}
                  expanded={expandedRecent}
                  onToggle={() => useTaskStore.getState().toggleRecent()}
                  headerIcon={<IconHistory width={16} height={16} />}
                  tasks={recentItems}
                  showPath
                  setMenu={setMenu}
                />
                {(hasSubProjects || rootProject.tasks.length > 0) && (
                  <div className="tasks-separator" />
                )}
              </>
            )}

            {rootProject.tasks.length > 0 && (
              <ProjectSection
                label={rootLabel}
                expanded={expandedProjects.has(rootProject.relativePath)}
                onToggle={() =>
                  useTaskStore.getState().toggleProject(rootProject.relativePath)
                }
                tasks={rootProject.tasks}
                setMenu={setMenu}
              />
            )}

            {hasSubProjects && rootProject.tasks.length > 0 && (
              <div className="tasks-separator" />
            )}

            {projects.map((p) => (
              <ProjectSection
                key={p.relativePath}
                label={p.relativePath}
                expanded={expandedProjects.has(p.relativePath)}
                onToggle={() => useTaskStore.getState().toggleProject(p.relativePath)}
                tasks={p.tasks}
                setMenu={setMenu}
              />
            ))}
          </>
        )}
      </div>
      {menu && <TaskContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

function TaskSection({
  headerLabel,
  expanded,
  onToggle,
  headerIcon,
  tasks,
  showPath,
  setMenu,
}: {
  headerLabel: string;
  expanded: boolean;
  onToggle: () => void;
  headerIcon: React.ReactNode;
  tasks: TaskItemDto[];
  showPath?: boolean;
  setMenu: (m: { x: number; y: number; task: TaskItemDto; inRecent: boolean } | null) => void;
}) {
  return (
    <>
      <div className="tasks-group-header" onClick={onToggle}>
        <span className="tasks-chevron">
          {expanded ? <IconChevronDown width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
        </span>
        <span className="tasks-header-icon">{headerIcon}</span>
        <span>{headerLabel}</span>
      </div>
      {expanded && (
        <div>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} showPath={showPath} indent setMenu={setMenu} />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectSection({
  label,
  expanded,
  onToggle,
  tasks,
  setMenu,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  tasks: TaskItemDto[];
  setMenu: (m: { x: number; y: number; task: TaskItemDto; inRecent: boolean } | null) => void;
}) {
  return (
    <>
      <div className="tasks-project-header" onClick={onToggle}>
        <span className="tasks-chevron">
          {expanded ? <IconChevronDown width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
        </span>
        <span className="tasks-header-icon">
          {expanded ? <IconFolderOpened width={16} height={16} /> : <IconFolder width={16} height={16} />}
        </span>
        <span>{label}</span>
      </div>
      {expanded && (
        <div>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} indent setMenu={setMenu} />
          ))}
        </div>
      )}
    </>
  );
}

/** DnD 拖拽落点指示器位置。 */
type DropPos = "before" | "after" | null;

function TaskRow({
  task,
  indent,
  showPath,
  setMenu,
}: {
  task: TaskItemDto;
  indent?: boolean;
  showPath?: boolean;
  setMenu: (m: { x: number; y: number; task: TaskItemDto; inRecent: boolean } | null) => void;
}) {
  const store = useTaskStore;
  const running = task.isRunning || store.getState().isRunning(task.id);
  // 订阅 optimisticRunningIds 变化以触发重渲染
  useTaskStore((s) => s.optimisticRunningIds.has(task.id));

  const [dropPos, setDropPos] = useState<DropPos>(null);
  const dragIdRef = useRef<string | null>(null);

  const cmd =
    task.source === "npm"
      ? `${task.packageManager} run ${task.name}`
      : task.name;
  const tooltip = `${cmd}\n${task.cwd}`;

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    // 视口边缘吸附交给 useClampedPosition
    setMenu({ x: e.clientX, y: e.clientY, task, inRecent: !!showPath });
  };

  return (
    <div
      className={`tasks-item${running ? " running" : ""}${dropPos ? " drag-over" : ""}`}
      data-id={task.id}
      draggable
      title={tooltip}
      onContextMenu={onContextMenu}
      onDragStart={(e) => {
        dragIdRef.current = task.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        (e.currentTarget as HTMLElement).style.opacity = "0.5";
      }}
      onDragEnd={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = "";
        setDropPos(null);
        dragIdRef.current = null;
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragIdRef.current || dragIdRef.current === task.id) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos: DropPos = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
        setDropPos(pos);
      }}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        e.preventDefault();
        const dragId = dragIdRef.current ?? e.dataTransfer.getData("text/plain");
        if (dragId && dragId !== task.id && dropPos) {
          void store.getState().reorder(dragId, task.id, dropPos);
        }
        setDropPos(null);
      }}
    >
      {dropPos === "before" && <div className="tasks-drop-indicator before" />}
      {indent && <span className="tasks-indent" />}
      <span className="tasks-item-icon">
        {task.source === "npm" ? (
          <IconNpm width={16} height={16} />
        ) : (
          <IconTerminal width={16} height={16} />
        )}
      </span>
      <span className="tasks-name">
        {task.name}
        {showPath && task.relativeDir && (
          <span className="tasks-path">{task.relativeDir}</span>
        )}
      </span>
      {running ? (
        <button
          type="button"
          className="tasks-stop-btn"
          title={t("Stop")}
          onClick={(e) => {
            e.stopPropagation();
            void store.getState().stop(task.id);
          }}
        >
          <IconStop width={13} height={13} />
        </button>
      ) : (
        <button
          type="button"
          className="tasks-run-btn"
          title={t("Run")}
          onClick={(e) => {
            e.stopPropagation();
            void store.getState().run(task.id);
          }}
        >
          <IconPlay width={13} height={13} />
        </button>
      )}
      {dropPos === "after" && <div className="tasks-drop-indicator after" />}
    </div>
  );
}

function TaskContextMenu({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; task: TaskItemDto; inRecent: boolean };
  onClose: () => void;
}) {
  const { task, inRecent } = menu;
  const running = task.isRunning || useTaskStore.getState().isRunning(task.id);
  const pinnedIds = new Set(
    useTaskStore.getState().pinnedItems.map((p) => p.id),
  );
  const isPinned = pinnedIds.has(task.id);
  const store = useTaskStore.getState();

  const runItem = running
    ? { label: t("Stop"), Icon: IconStop, run: () => store.stop(task.id) }
    : { label: t("Run"), Icon: IconPlay, run: () => store.run(task.id) };

  const items: ContextMenuEntry[] = [
    { key: "run", label: runItem.label, icon: runItem.Icon, onSelect: runItem.run },
    { key: "sep1", separator: true },
    isPinned
      ? { key: "pin", label: t("Unpin"), icon: IconPinned, onSelect: () => store.unpin(task.id) }
      : { key: "pin", label: t("Pin"), icon: IconPin, onSelect: () => store.pin(task.id) },
  ];
  if (inRecent) {
    items.push(
      { key: "sep2", separator: true },
      {
        key: "remove",
        label: t("Remove from recent"),
        icon: IconClose,
        onSelect: () => store.removeRecent(task.id),
      },
    );
  }

  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />;
}
