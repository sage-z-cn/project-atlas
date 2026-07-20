import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import ErrorIcon from "~icons/codicon/error";
import CloseIcon from "~icons/codicon/close";

/**
 * 顶部错误 banner：展示远程操作（如 pull）失败的 git 错误。
 *
 * 复用 CommitMessageArea 的 commit-error-banner 样式（多行 stderr 通过
 * `white-space: pre-wrap` 自然换行）。容器外层加 padding + flexShrink: 0
 * 让它贴边显示，与 RebaseBanner / MergeBanner 的容器样式一致。
 */
export function ErrorBanner() {
  const remoteError = useCommitStore((s) => s.remoteError);
  const setRemoteError = useCommitStore((s) => s.setRemoteError);

  if (!remoteError) return null;

  return (
    <div style={{ padding: "6px 12px", flexShrink: 0 }}>
      <div className="commit-error-banner" role="alert">
        <ErrorIcon className="commit-error-icon" />
        <span className="commit-error-message">{remoteError}</span>
        <button
          type="button"
          className="commit-error-close"
          aria-label={t("Dismiss")}
          onClick={() => setRemoteError(null)}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
