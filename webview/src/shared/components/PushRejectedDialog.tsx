import { t } from "../i18n";
import "./PushRejectedDialog.css";

/**
 * push 被拒（non-fast-forward）时的 Rebase/Merge 选择对话框。
 * 从 push 面板抽取到 shared，供 push 面板与 commit 面板共用：
 * push 面板在面板内推送被拒时弹出；commit 面板在跳过推送确认的
 * 推送被拒时弹出（pushRejected 状态驱动）。
 */
export function PushRejectedDialog({
  branchName,
  busy = null,
  error = null,
  onRebase,
  onMerge,
  onCancel,
}: {
  branchName: string;
  /** rebase/merge 执行中标记：非 null 时禁用全部按钮并切换对应文案。 */
  busy?: "rebase" | "merge" | null;
  /** 非 null 时在按钮区上方渲染错误文本，如重试推送仍被拒。 */
  error?: string | null;
  onRebase: () => void;
  onMerge: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="push-rejected-overlay">
      <div className="push-rejected-dialog">
        <div className="push-rejected-header">
          <span className="push-rejected-icon">!</span>
          <span className="push-rejected-title">{t("Push Rejected")}</span>
        </div>
        <p className="push-rejected-message">
          {t(
            "Push of the current branch '{0}' was rejected. Remote changes need to be merged before pushing.",
            branchName,
          )}
        </p>
        {error != null && <p className="push-rejected-error">{error}</p>}
        <div className="push-rejected-actions">
          <button
            type="button"
            className="push-rejected-btn push-rejected-btn-cancel"
            onClick={onCancel}
            disabled={busy != null}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            className="push-rejected-btn push-rejected-btn-rebase"
            onClick={onRebase}
            disabled={busy != null}
          >
            {busy === "rebase" ? t("Rebasing") : t("Rebase")}
          </button>
          <button
            type="button"
            className="push-rejected-btn push-rejected-btn-merge"
            onClick={onMerge}
            disabled={busy != null}
          >
            {busy === "merge" ? t("Merging") : t("Merge")}
          </button>
        </div>
      </div>
    </div>
  );
}
