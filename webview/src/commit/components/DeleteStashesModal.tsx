import { t } from "../../shared/i18n";
import type { StashEntry } from "../../shared/store/commit-store";
import { ModalOverlay } from "./Modal";
import CloseIcon from "~icons/codicon/close";

/** 列表内最多展示的条目数，超出折叠为「…等 N 项」。 */
const MAX_VISIBLE = 5;

interface DeleteStashesModalProps {
  entries: StashEntry[];
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 批量删除贮藏的确认弹窗。由 StashTab 在用户勾选后点工具栏删除 /
 * 右键批量删除时打开；确认后走 store.deleteStashes（扩展端无二次原生确认）。
 */
export function DeleteStashesModal({
  entries,
  onCancel,
  onConfirm,
}: DeleteStashesModalProps) {
  const visible = entries.slice(0, MAX_VISIBLE);
  const hiddenCount = entries.length - visible.length;

  return (
    <ModalOverlay
      onClose={onCancel}
      ariaLabel={t("Delete")}
      cardClass="modal-sm"
    >
      <div className="new-version-modal-head">
        <span className="new-version-modal-title">{t("Delete")}</span>
        <button
          type="button"
          className="commit-message-banner-close"
          aria-label={t("Cancel")}
          onClick={onCancel}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="new-version-prompt-help">
        {t(
          "Delete {0} stashed changes? This cannot be undone.",
          entries.length,
        )}
      </div>

      <div className="delete-stashes-list">
        {visible.map((entry) => (
          <div key={entry.sha} className="delete-stashes-item">
            <span className="delete-stashes-sha">{entry.sha.slice(0, 8)}</span>
            <span className="delete-stashes-msg">
              {entry.message || t("Changes")}
            </span>
          </div>
        ))}
        {hiddenCount > 0 && (
          <div className="delete-stashes-more">
            {t("and {0} more", hiddenCount)}
          </div>
        )}
      </div>

      <div className="new-version-prompt-actions">
        <span className="new-version-prompt-spacer" />
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          {t("Delete")}
        </button>
      </div>
    </ModalOverlay>
  );
}
