import type React from "react";
import { useRef, useState } from "react";
import { t } from "../shared/i18n";
import { useRecentStore } from "../shared/store/recent-store";
import { ModalOverlay } from "../shared/components/Modal";
import "../shared/components/Dialog.css";
import IconClose from "~icons/codicon/close";
import IconSearch from "~icons/codicon/search";
import IconFolder from "~icons/codicon/folder";
import IconRootFolder from "~icons/codicon/root-folder";
import IconCheck from "~icons/codicon/check";
import IconChevronRight from "~icons/codicon/chevron-right";

// ── Add-to-favorites group picker ────────────────────────────────────────────
// 替代 host 端原生 QuickPick：executeAction("addFavorite") 先经 store 的
// promptAddFavorite 拉取可选分组，非空时打开本弹窗；确认后对每个项目 id 发
// addFavorite { id, groupId }（同一所选分组），取消 / Escape / 点遮罩整个
// 动作中止。无分组时 store 直接落根，不进入本组件。

/** 分组数超过该阈值才显示搜索框；少于此保持简洁。 */
const SEARCH_THRESHOLD = 8;

export function AddFavoriteDialog() {
  const open = useRecentStore((s) => s.addFavoritePrompt.open);
  if (!open) return null;
  // 每次打开重新 mount（外层 gate），选中态与搜索词随之重置。
  return <AddFavoriteCard />;
}

type OptionIcon = (props: {
  width?: number;
  height?: number;
  className?: string;
}) => React.JSX.Element;

function AddFavoriteCard() {
  const ids = useRecentStore((s) => s.addFavoritePrompt.ids);
  const groups = useRecentStore((s) => s.addFavoritePrompt.groups);
  const confirmAddFavorite = useRecentStore((s) => s.confirmAddFavorite);
  const cancelAddFavorite = useRecentStore((s) => s.cancelAddFavorite);

  // null = 根分组（host 契约：groupId 传 null 落根），默认选中根。
  const [groupId, setGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const showSearch = groups.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? groups.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.path.toLowerCase().includes(q),
      )
    : groups;
  const rootMatch = !q || t("Root").toLowerCase().includes(q);
  const hasOptions = rootMatch || filtered.length > 0;

  // 搜索把当前选中过滤掉时，选中态收敛到首个可见选项，避免确认到隐藏项。
  const selectionFits =
    groupId === null ? rootMatch : filtered.some((g) => g.id === groupId);
  const effectiveGroupId = selectionFits
    ? groupId
    : rootMatch
      ? null
      : (filtered[0]?.id ?? null);

  const count = ids.length;
  const title =
    count > 1
      ? t("Add {0} project(s) to Favorites", count)
      : t("Add to Favorites");

  const confirm = () => {
    if (!hasOptions) return;
    void confirmAddFavorite(effectiveGroupId);
  };

  // 可见选项的 id 序列（null = 根），与 DOM 中 .fav-dialog-option 顺序一致。
  const visibleIds: (string | null)[] = [
    ...(rootMatch ? [null] : []),
    ...filtered.map((g) => g.id),
  ];

  const optionButtons = (): HTMLButtonElement[] =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        ".fav-dialog-option",
      ) ?? [],
    );

  const moveSelection = (index: number) => {
    const buttons = optionButtons();
    if (buttons.length === 0) return;
    const clamped = Math.max(0, Math.min(buttons.length - 1, index));
    setGroupId(visibleIds[clamped] ?? null);
    buttons[clamped].focus();
  };

  // 列表容器统一处理键盘：Enter 确认（含从选项按钮冒泡，preventDefault
  // 阻止按钮的合成 click 造成二次触发）；方向键 / Home / End 移动选中。
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
      return;
    }
    const current = visibleIds.indexOf(effectiveGroupId);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveSelection(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveSelection(visibleIds.length - 1);
    }
  };

  // 搜索框：Enter 确认，ArrowDown 进入列表（焦点即选中）。
  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(0);
    }
  };

  return (
    <ModalOverlay
      onClose={cancelAddFavorite}
      ariaLabel={title}
      initialFocusRef={selectedRef}
      cardClass="modal-sm"
    >
      <div className="dialog-head">
        <span className="dialog-title">{title}</span>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("Cancel")}
          onClick={cancelAddFavorite}
        >
          <IconClose />
        </button>
      </div>

      <div className="dialog-help">{t("Select group for favorite")}</div>

      {showSearch && (
        <div className="fav-dialog-search-box">
          <IconSearch width={13} height={13} />
          <input
            type="text"
            className="fav-dialog-search-input"
            value={query}
            placeholder={t("Search groups...")}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
      )}

      <div
        ref={listRef}
        className="fav-dialog-list"
        role="radiogroup"
        aria-label={t("Select group for favorite")}
        onKeyDown={onListKeyDown}
      >
        {rootMatch && (
          <FavoriteGroupOption
            selected={effectiveGroupId === null}
            Icon={IconRootFolder}
            label={t("Root")}
            breadcrumb={[]}
            onSelect={() => setGroupId(null)}
            onConfirm={confirm}
            selectedRef={(el) => {
              if (el && effectiveGroupId === null) selectedRef.current = el;
            }}
          />
        )}
        {filtered.map((g) => (
          <FavoriteGroupOption
            key={g.id}
            selected={effectiveGroupId === g.id}
            Icon={IconFolder}
            label={g.name}
            breadcrumb={breadcrumbOf(g)}
            onSelect={() => setGroupId(g.id)}
            onConfirm={confirm}
            selectedRef={(el) => {
              if (el && effectiveGroupId === g.id) selectedRef.current = el;
            }}
          />
        ))}
        {!hasOptions && (
          <div className="fav-dialog-empty">{t("No matching groups")}</div>
        )}
      </div>

      <div className="dialog-actions">
        <span className="dialog-spacer" />
        <button
          type="button"
          className="dialog-btn dialog-btn-secondary"
          onClick={cancelAddFavorite}
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="dialog-btn dialog-btn-primary"
          onClick={confirm}
          disabled={!hasOptions}
        >
          {t("Add to Favorites")}
        </button>
      </div>
    </ModalOverlay>
  );
}

/** path 末段即分组自身名；嵌套分组仅展示祖先链，顶级分组不再重复一行。 */
function breadcrumbOf(g: { name: string; path: string }): string[] {
  const segments = g.path.split(" / ").map((s) => s.trim()).filter(Boolean);
  return segments.length > 1 ? segments.slice(0, -1) : [];
}

function FavoriteGroupOption({
  selected,
  Icon,
  label,
  breadcrumb,
  onSelect,
  onConfirm,
  selectedRef,
}: {
  selected: boolean;
  Icon: OptionIcon;
  label: string;
  breadcrumb: string[];
  onSelect: () => void;
  onConfirm: () => void;
  /** 仅选中项登记元素，供 ModalOverlay 打开时落焦点。 */
  selectedRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`fav-dialog-option${selected ? " selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onConfirm}
      ref={selectedRef}
    >
      <span className="fav-dialog-option-icon">
        <Icon width={16} height={16} />
      </span>
      <span className="fav-dialog-option-body">
        <span className="fav-dialog-option-name">{label}</span>
        {breadcrumb.length > 0 && (
          <span className="fav-dialog-breadcrumb">
            {breadcrumb.map((segment, i) => (
              <span key={i} className="fav-dialog-breadcrumb-seg">
                {i > 0 && <IconChevronRight width={10} height={10} />}
                {segment}
              </span>
            ))}
          </span>
        )}
      </span>
      {selected && (
        <span className="fav-dialog-check">
          <IconCheck width={14} height={14} />
        </span>
      )}
    </button>
  );
}
