import { t } from "../../shared/i18n";
import { useMergeStore } from "../../shared/store/merge-store";
import ErrorIcon from "~icons/codicon/error";
import CloseIcon from "~icons/codicon/close";

/**
 * Conflicts 视图顶部错误 banner：展示冲突列表 / merge editor 操作失败的错误，
 * 绑定到 merge-store.conflictError。
 *
 * conflicts 目录没有 CSS 文件（所有 conflicts 组件均使用内联样式），所以这里
 * 也用内联样式，视觉与 commit-error-banner / panel-error-banner 保持一致
 * （同样的 vscode inputValidation 错误色 token + pre-wrap 多行换行）。
 */
export function ErrorBanner() {
  const conflictError = useMergeStore((s) => s.conflictError);
  const setConflictError = useMergeStore((s) => s.setConflictError);

  if (!conflictError) return null;

  return (
    <div style={{ padding: "6px 12px", flexShrink: 0 }}>
      <div
        role="alert"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          padding: "6px 8px",
          borderRadius: 6,
          background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
          border: "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
        <ErrorIcon
          style={{
            flexShrink: 0,
            width: 16,
            height: 16,
            color: "var(--vscode-errorForeground, #f48771)",
          }}
        />
        <span
          style={{
            flex: 1,
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
            color: "var(--app-fg, #ccc)",
          }}
        >
          {conflictError}
        </span>
        <button
          type="button"
          aria-label={t("Dismiss")}
          onClick={() => setConflictError(null)}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--app-fg, #ccc)",
            cursor: "pointer",
            borderRadius: 3,
            opacity: 0.7,
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
