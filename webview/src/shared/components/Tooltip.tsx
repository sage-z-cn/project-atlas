import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  text: string;
  children: ReactNode;
  delay?: number;
  position?: "top" | "bottom";
}

export function Tooltip({
  text,
  children,
  delay = 300,
  position = "top",
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [actualPosition, setActualPosition] = useState(position);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
    setCoords(null);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Position the tooltip using fixed positioning relative to viewport
  useEffect(() => {
    if (!visible || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const gap = 4;

    let top: number;
    let actualPosition = position;

    // If position is "top" but there's not enough space above, flip to bottom
    if (position === "top" && rect.top < 30) {
      actualPosition = "bottom";
    }

    if (actualPosition === "top") {
      top = rect.top - gap;
    } else {
      top = rect.bottom + gap;
    }

    // Center horizontally on the trigger element
    const left = rect.left + rect.width / 2;

    setCoords({ top, left });
    setActualPosition(actualPosition);
  }, [visible, position]);

  // Adjust if tooltip overflows viewport.
  // Single clamped shift — never two competing setCoords calls. When the tooltip
  // is wider than the viewport, prefer pinning the left edge; alternating
  // left/right corrections re-trigger this effect and flicker forever.
  useEffect(() => {
    if (!visible || !coords || !tooltipRef.current) return;

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const margin = 4;
    const maxRight = window.innerWidth - margin;

    let shift = 0;
    if (tooltipRect.left < margin) {
      shift = margin - tooltipRect.left;
    }
    if (tooltipRect.right + shift > maxRight) {
      shift = maxRight - tooltipRect.right;
    }
    // Too wide to fit: pin left edge so the correction converges.
    if (tooltipRect.left + shift < margin) {
      shift = margin - tooltipRect.left;
    }

    if (shift !== 0) {
      setCoords((prev) =>
        prev ? { ...prev, left: prev.left + shift } : prev,
      );
    }
  }, [visible, coords]);

  return (
    <div
      ref={containerRef}
      className="tooltip-wrapper"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible &&
        coords &&
        createPortal(
          <div
            ref={tooltipRef}
            className="tooltip-popup"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform:
                actualPosition === "top"
                  ? "translate(-50%, -100%)"
                  : "translateX(-50%)",
              zIndex: 99999,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </div>
  );
}
