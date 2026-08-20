import type React from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// ── Shared modal skeleton ────────────────────────────────────────────────────
// DOM-overlay modal (webviews have no native <dialog> under the CSP):
// fixed backdrop + centered card, Escape / backdrop-click closes, minimal
// Tab focus trap, initial focus lands on `initialFocusRef` (or the card).
// Generic `.modal-*` classes — no feature-specific prefix (newVersion/release
// both render through this component).

interface ModalOverlayProps {
  onClose: () => void;
  ariaLabel: string;
  /** Element to focus on open; the card itself (tabIndex -1) when omitted. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Extra class for the card (e.g. width variant). */
  cardClass?: string;
  children: React.ReactNode;
}

export function ModalOverlay({
  onClose,
  ariaLabel,
  initialFocusRef,
  cardClass,
  children,
}: ModalOverlayProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (initialFocusRef?.current ?? modalRef.current)?.focus();
  }, [initialFocusRef]);

  // Escape closes (document-level so it works regardless of focus location).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Minimal Tab focus trap: cycle within the modal.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusables = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, textarea, input, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="modal-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${cardClass ? ` ${cardClass}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        ref={modalRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
