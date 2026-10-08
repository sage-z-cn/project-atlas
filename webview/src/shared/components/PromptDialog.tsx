import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { ModalOverlay } from "./Modal";
import IconClose from "~icons/codicon/close";
import "./Dialog.css";

// ── Shared text-input dialog ─────────────────────────────────────────────────
// 单输入弹窗（替代 host 原生 showInputBox）：标题 / 说明 / 输入框 / 确认取消。
// Enter 确认、Escape / backdrop / 取消按钮取消；trim 后空值禁用确认。
// 视觉与交互参考 StashPromptModal（modal-sm + dialog-* chrome）。

interface PromptDialogProps {
  /** 弹窗标题（已翻译）。 */
  title: string;
  /** 输入框上方说明（已翻译，可选）。 */
  label?: string;
  /** 初始值（重命名场景）；打开时全选，输入即替换。 */
  initialValue?: string;
  placeholder?: string;
  /** 确认按钮文案（已翻译）。 */
  confirmLabel: string;
  cancelLabel?: string;
  /** value 已 trim；组件保证非空才回调。 */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  title,
  label,
  initialValue,
  placeholder,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelText = cancelLabel ?? t("Cancel");

  const trimmed = value.trim();
  const confirm = () => {
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  // 重命名场景全选初始值：焦点落下后直接打字即覆盖，Enter 即原样提交。
  useEffect(() => {
    if (initialValue) inputRef.current?.select();
  }, [initialValue]);

  return (
    <ModalOverlay
      onClose={onCancel}
      ariaLabel={title}
      initialFocusRef={inputRef}
      cardClass="modal-sm"
    >
      <div className="dialog-head">
        <span className="dialog-title">{title}</span>
        <button
          type="button"
          className="dialog-close"
          aria-label={cancelText}
          onClick={onCancel}
        >
          <IconClose />
        </button>
      </div>

      {label && <div className="dialog-help">{label}</div>}

      <input
        ref={inputRef}
        type="text"
        className="dialog-input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            confirm();
          }
        }}
      />

      <div className="dialog-actions">
        <span className="dialog-spacer" />
        <button
          type="button"
          className="dialog-btn dialog-btn-secondary"
          onClick={onCancel}
        >
          {cancelText}
        </button>
        <button
          type="button"
          className="dialog-btn dialog-btn-primary"
          disabled={!trimmed}
          onClick={confirm}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalOverlay>
  );
}
