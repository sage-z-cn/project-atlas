import { t } from "../../shared/i18n";
import { usePanelStore } from "../../shared/store/panel-store";
import ErrorIcon from "~icons/codicon/error";
import CloseIcon from "~icons/codicon/close";

/**
 * 顶部错误 banner：展示 Git Log 面板里 git 操作（push / pull / merge /
 * rebase / cherry-pick / reset / tag ...）失败的 git 错误。
 *
 * 使用 panel.css 里的 panel-error-banner 样式（多行 stderr 通过
 * `white-space: pre-wrap` 自然换行）。容器外层加 padding + flexShrink: 0
 * 让它贴边显示。挂在 RepoSelector 之上、ProgressBar 之下。
 */
export function ErrorBanner() {
  const panelError = usePanelStore((s) => s.panelError);
  const setPanelError = usePanelStore((s) => s.setPanelError);

  if (!panelError) return null;

  return (
    <div style={{ padding: "6px 12px", flexShrink: 0 }}>
      <div className="panel-error-banner" role="alert">
        <ErrorIcon className="panel-error-icon" />
        <span className="panel-error-message">{panelError}</span>
        <button
          type="button"
          className="panel-error-close"
          aria-label={t("Dismiss")}
          onClick={() => setPanelError(null)}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
