import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import ErrorIcon from "~icons/codicon/error";
import CheckIcon from "~icons/codicon/check";
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
      variant="error"
      message={commitError}
      onDismiss={() => setCommitError(null)}
    />
  );
}

/**
 * 工具栏下方的远程操作反馈 banner：
 * - remoteError：远程操作（如 pull）失败的 git 错误。
 * - remoteSuccess：远程操作成功提示（如推送完成），5s 后自动消失（store
 *   showRemoteSuccess 负责计时），也可手动关闭。
 * 两者互斥由 store 写入时保证（setRemoteError / setRemoteSuccess 非空写入
 * 顶掉对方），不叠两条 banner。
 */
export function RemoteBanner() {
  const remoteError = useCommitStore((s) => s.remoteError);
  const setRemoteError = useCommitStore((s) => s.setRemoteError);
  const remoteSuccess = useCommitStore((s) => s.remoteSuccess);
  const setRemoteSuccess = useCommitStore((s) => s.setRemoteSuccess);

  return (
    <>
      {remoteError && (
        <BannerItem
          variant="error"
          message={remoteError}
          onDismiss={() => setRemoteError(null)}
        />
      )}
      {remoteSuccess && (
        <BannerItem
          variant="success"
          message={remoteSuccess}
          onDismiss={() => setRemoteSuccess(null)}
        />
      )}
    </>
  );
}

function BannerItem({
  variant,
  message,
  onDismiss,
}: {
  variant: "error" | "success";
  message: string;
  onDismiss: () => void;
}) {
  const isError = variant === "error";
  return (
    <div style={{ padding: "4px 8px", flexShrink: 0 }}>
      <div
        className={isError ? "commit-message-banner" : "commit-message-banner-success"}
        role={isError ? "alert" : "status"}
      >
        {isError ? (
          <ErrorIcon className="commit-message-banner-icon" />
        ) : (
          <CheckIcon className="commit-message-banner-icon-success" />
        )}
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
