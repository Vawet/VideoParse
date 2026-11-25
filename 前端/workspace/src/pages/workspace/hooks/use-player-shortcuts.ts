import { useEffect, useRef } from "react";
import { usePlayback } from "../hooks/use-workspace";

const FORM_FIELDS = "input, textarea, select, [contenteditable='true'], [role='textbox']";

/**
 * Space toggles playback, ← / → seek by five seconds.
 * Shortcuts stay quiet while the focus sits in a field, a button or a slider.
 */
export function usePlayerShortcuts(enabled: boolean) {
  const { toggle, skip } = usePlayback();
  const handlers = useRef({ toggle, skip });
  handlers.current = { toggle, skip };

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(`${FORM_FIELDS}, nav, button, a, [role='dialog'], [role='slider'], [role='tab']`)) return;

      if (event.code === "Space") {
        event.preventDefault();
        handlers.current.toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlers.current.skip(-5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handlers.current.skip(5);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
