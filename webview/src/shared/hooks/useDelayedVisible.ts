import { useEffect, useState } from "react";

/**
 * Progress-indicator visibility with a rising-edge delay.
 *
 * Rising edge waits `delayMs` before flipping true so ops that finish faster
 * than the delay never flash a bar; falling edge is immediate so the bar
 * disappears the moment work completes.
 */
export function useDelayedVisible(visible: boolean, delayMs = 180): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [visible, delayMs]);

  return shown;
}
