import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";

export interface CreateTagDialogProps {
  /**
   * Title shown at top — a ReactNode so callers can italicize the commit
   * subject segment, e.g. Create tag at 'main <em>fix login bug</em>'
   */
  title: React.ReactNode;
  /** Default value for tag name input */
  defaultName?: string;
  /** Placeholder for the tag name input */
  placeholder?: string;
  onClose: () => void;
  /** Return a string error message to keep the dialog open and show it */
  onConfirm: (params: {
    tagName: string;
    /** Annotated tag message; empty = lightweight tag */
    message: string;
  }) => Promise<string | undefined>;
}

export function CreateTagDialog({
  title,
  defaultName = "",
  placeholder = "tag-name",
  onClose,
  onConfirm,
}: CreateTagDialogProps) {
  const [tagName, setTagName] = useState(defaultName);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus and select input on mount
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !submitting) {
        handleSubmit();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const handleSubmit = useCallback(async () => {
    const trimmed = tagName.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const errMsg = await onConfirm({
        tagName: trimmed,
        message: message.trim(),
      });
      if (errMsg) {
        setError(errMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [tagName, message, onConfirm]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.4)",
      }}
    >
      <div
        style={{
          background: "var(--vscode-editorWidget-background, #252526)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "16px 20px",
          minWidth: 380,
          maxWidth: 500,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Title */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--app-fg)",
          }}
        >
          {title}
        </div>

        {/* Error Message */}
        {error && (
          <div
            style={{
              background:
                "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
              border:
                "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
              borderRadius: 4,
              padding: "8px 10px",
              marginBottom: 12,
              fontSize: 12,
              color: "var(--vscode-errorForeground, #f48771)",
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Tag Name Input */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <label
              htmlFor="tag-name-input"
              style={{
                fontSize: 12,
                color: "var(--description-fg)",
                whiteSpace: "nowrap",
              }}
            >
              {t("Tag Name:")}
            </label>
            <input
              ref={inputRef}
              id="tag-name-input"
              type="text"
              value={tagName}
              onChange={(e) => {
                setTagName(e.target.value);
                setError(null);
              }}
              placeholder={placeholder}
              style={{
                flex: 1,
                background: "var(--input-bg)",
                color: "var(--input-fg)",
                border: error
                  ? "1px solid var(--vscode-inputValidation-errorBorder, #be1100)"
                  : "1px solid var(--input-border)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: "var(--font-size)",
                fontFamily: "var(--font-family)",
                outline: "none",
                height: 28,
              }}
            />
          </div>
        </div>

        {/* Annotation Message Input (optional — empty creates a lightweight tag) */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <label
              htmlFor="tag-message-input"
              style={{
                fontSize: 12,
                color: "var(--description-fg)",
                whiteSpace: "nowrap",
              }}
            >
              {t("Annotation Message:")}
            </label>
            <input
              id="tag-message-input"
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("Optional")}
              style={{
                flex: 1,
                background: "var(--input-bg)",
                color: "var(--input-fg)",
                border: "1px solid var(--input-border)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: "var(--font-size)",
                fontFamily: "var(--font-family)",
                outline: "none",
                height: 28,
              }}
            />
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, var(--app-fg))",
              border: "none",
              borderRadius: 4,
              padding: "4px 14px",
              fontSize: 12,
              height: 28,
              cursor: "pointer",
            }}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!tagName.trim() || submitting}
            style={{
              background: "var(--button-bg)",
              color: "var(--button-fg)",
              border: "none",
              borderRadius: 4,
              padding: "4px 14px",
              fontSize: 12,
              height: 28,
              cursor: tagName.trim() && !submitting ? "pointer" : "default",
              opacity: tagName.trim() && !submitting ? 1 : 0.4,
            }}
          >
            {t("Create")}
          </button>
        </div>
      </div>
    </div>
  );
}
