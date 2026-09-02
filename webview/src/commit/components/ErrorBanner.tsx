import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import ErrorIcon from "~icons/codicon/error";
import CloseIcon from "~icons/codicon/close";

/**
 * 顶部错误 banner（App 级，所有 tab 可见）：
 * - remoteError：远程操作（如 pull）失败的 git 错误。
 * - commitError：commit/stash 等本地操作失败的内联错误。Commit tab 下与
 *   CommitMessageArea 的内联显示并存是有意的 —— stash/newVersion/release
 *   tab 没有消息区，App 级 banner 保证错误在任何 tab 都可见。
 *
 * 复用 CommitMessageArea 的 commit-error-banner 样式（多行 stderr 通过
 * `white-space: pre-wrap` 自然换行）。容器外层加 padding + flexShrink: 0
 * 让它贴边显示，与 RebaseBanner / MergeBanner 的容器样式一致。
 */
export function ErrorBanner() {
  const commitError = useCommitStore((s) => s.commitError);
  const setCommitError = useCommitStore((s) => s.setCommitError);
  const remoteError = useCommitStore((s) => s.remoteError);
  const setRemoteError = useCommitStore((s) => s.setRemoteError);

  return (
    <>
      {commitError && (
        <ErrorBannerItem
          message={commitError}
          onDismiss={() => setCommitError(null)}
        />
      )}
      {remoteError && (
        <ErrorBannerItem
          message={remoteError}
          onDismiss={() => setRemoteError(null)}
        />
      )}
    </>
  );
}

function ErrorBannerItem({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div style={{ padding: "6px 12px", flexShrink: 0 }}>
      <div className="commit-error-banner" role="alert">
        <ErrorIcon className="commit-error-icon" />
        <span className="commit-error-message">{message}</span>
        <button
          type="button"
          className="commit-error-close"
          aria-label={t("Dismiss")}
          onClick={onDismiss}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
