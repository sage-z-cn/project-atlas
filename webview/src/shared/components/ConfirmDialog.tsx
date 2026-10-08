import type React from "react";
import { useRef, useState } from "react";
import { t } from "../i18n";
import { ModalOverlay } from "./Modal";
import IconClose from "~icons/codicon/close";
import "./Dialog.css";

// ── Shared confirm dialog ────────────────────────────────────────────────────
// 确认弹窗（替代 host 原生 showWarningMessage / 二选一）：消息 + 危险动作
// 按钮语言（参考 DeleteStashesModal）。可选 "不再询问" 复选框变体（勾选态
// 随 onConfirm 回传）；可选双选择变体（altChoice 在取消与主确认之间多一枚
// 次级选择按钮，如「移至上级 / 全部取消收藏」）。
// 焦点落在主确认按钮（Enter 确认）；Escape / backdrop / 取消按钮中止。

/** 双选择变体的次级选择（渲染为 secondary 按钮）。 */
export interface ConfirmDialogAltChoice {
  label: string;
  onChoose: () => void;
}

interface ConfirmDialogProps {
  /** 弹窗标题（已翻译）。 */
  title: string;
  /** 消息（已翻译，支持任意节点）。 */
  message: React.ReactNode;
  /** 主确认按钮文案（已翻译）。 */
  confirmLabel: string;
  /** dontAsk 为 true 时回传复选框勾选态，否则恒 false。 */
  onConfirm: (dontAsk: boolean) => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** 主按钮走危险语言（errorForeground），默认 true。 */
  danger?: boolean;
  /** 显示「不再询问」复选框。 */
  dontAsk?: boolean;
  altChoice?: ConfirmDialogAltChoice;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel,
  danger = true,
  dontAsk = false,
  altChoice,
}: ConfirmDialogProps) {
  const [neverAsk, setNeverAsk] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelText = cancelLabel ?? t("Cancel");

  return (
    <ModalOverlay
      onClose={onCancel}
      ariaLabel={title}
      initialFocusRef={confirmRef}
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

      <div className="dialog-help">{message}</div>

      {dontAsk && (
        <label className="dialog-check-row">
          <input
            type="checkbox"
            checked={neverAsk}
            onChange={(e) => setNeverAsk(e.target.checked)}
          />
          <span>{t("Don't Ask Again")}</span>
        </label>
      )}

      <div className="dialog-actions">
        <span className="dialog-spacer" />
        <button
          type="button"
          className="dialog-btn dialog-btn-secondary"
          onClick={onCancel}
        >
          {cancelText}
        </button>
        {altChoice && (
          <button
            type="button"
            className="dialog-btn dialog-btn-secondary"
            onClick={altChoice.onChoose}
          >
            {altChoice.label}
          </button>
        )}
        <button
          ref={confirmRef}
          type="button"
          className={`dialog-btn ${danger ? "dialog-btn-danger" : "dialog-btn-primary"}`}
          onClick={() => onConfirm(neverAsk)}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalOverlay>
  );
}
