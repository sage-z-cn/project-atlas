import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import ErrorIcon from "~icons/codicon/error";
import CloseIcon from "~icons/codicon/close";

/**
 * App 级 commitError 兜底 banner（tabs 下方）：Commit tab 下由
 * CommitMessageArea 在消息框上方内联展示，此处不再重复；stash/newVersion/
 * release tab 没有消息区，才由本 banner 兜底展示。
 *
 * 复用 commit-message-banner 样式。容器外层加 padding + flexShrink: 0 让它
 * 贴边显示，与 RebaseBanner / MergeBanner 一致。
 */
export function MessageBanner() {
  const activeTab = useCommitStore((s) => s.activeTab);
  const commitError = useCommitStore((s) => s.commitError);
  const setCommitError = useCommitStore((s) => s.setCommitError);

  // Commit 页已有底部内联展示，避免同一条 commitError 上下同时出现。
  const showCommitErrorHere = activeTab !== "commit";

  if (!showCommitErrorHere || !commitError) return null;

  return (
    <BannerItem
      message={commitError}
      onDismiss={() => setCommitError(null)}
    />
  );
}

/**
 * 工具栏下方的远程操作反馈 banner：
 * - remoteError：远程操作（pull / push）失败的 git 错误。
 * 推送成功反馈已改为仓库 chip 短暂打勾（见 commit-store 的
 * showRepoSuccessFlash），不再走此处。
 */
export function RemoteBanner() {
  const remoteError = useCommitStore((s) => s.remoteError);
  const setRemoteError = useCommitStore((s) => s.setRemoteError);

  if (!remoteError) return null;

  return (
    <BannerItem
      message={remoteError}
      onDismiss={() => setRemoteError(null)}
    />
  );
}

function BannerItem({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div style={{ padding: "4px 8px", flexShrink: 0 }}>
      <div className="commit-message-banner" role="alert">
        <ErrorIcon className="commit-message-banner-icon" />
        <span className="commit-message-banner-text">{message}</span>
        <button
          type="button"
          className="commit-message-banner-close"
          aria-label={t("Dismiss")}
          onClick={onDismiss}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
