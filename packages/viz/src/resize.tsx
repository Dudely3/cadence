import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draggable pane widths, remembered.
 *
 * The reason this exists is a room, not a preference: the three-pane layout
 * (slides · run · anatomy) divides a fixed screen three ways, and whichever
 * pane you are talking about at the time needs to be readable from the back
 * row. A fixed grid cannot know which one that is. Dragging can, and
 * persisting means you set it once for the projector and it stays set.
 *
 * Widths are stored in px per pane key, with the LAST pane taking whatever is
 * left — so the layout still reflows when a panel opens or closes, and only
 * the explicitly-sized panes are pinned.
 */

const KEY_PREFIX = "cadence.pane.";

function load(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    // Private windows and blocked site data both throw here. A remembered
    // width is a convenience; losing it must not take the viewer down.
    return fallback;
  }
}

function save(key: string, value: number): void {
  try {
    localStorage.setItem(KEY_PREFIX + key, String(value));
  } catch {
    /* nothing to do — the layout still works, it just won't be remembered */
  }
}

export interface PaneWidth {
  width: number;
  /** Attach to a Grip. */
  onDrag: (deltaPx: number) => void;
  reset: () => void;
}

/**
 * One resizable pane. `min`/`max` are hard stops: a pane that can be dragged
 * to nothing is a pane you can lose mid-talk with no obvious way back.
 */
export function usePaneWidth(
  key: string,
  initial: number,
  min: number,
  max: number,
): PaneWidth {
  const [width, setWidth] = useState(() => load(key, initial));
  // Drag from the width at pointer-down, not the current one: reading state
  // inside the move handler accumulates rounding and the pane drifts.
  const start = useRef(width);

  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, Math.round(n))),
    [min, max],
  );

  const onDrag = useCallback(
    (delta: number) => {
      setWidth((current) => {
        if (delta === 0) start.current = current; // pointer-down marker
        const next = clamp(start.current + delta);
        save(key, next);
        return next;
      });
    },
    [clamp, key],
  );

  const reset = useCallback(() => {
    setWidth(clamp(initial));
    save(key, clamp(initial));
  }, [clamp, initial, key]);

  // A remembered width can be wider than today's window — a laptop after an
  // external display. Pull it back inside the current bounds on mount.
  useEffect(() => {
    setWidth((w) => clamp(w));
  }, [clamp]);

  return { width, onDrag, reset };
}

/**
 * The window's current inner width.
 *
 * A pane's maximum has to be a fraction of the room it is in, not a constant:
 * 900px is a third of a 2560px projector and more than the whole of a 1366px
 * laptop. Feeding this into `usePaneWidth`'s `max` also re-clamps a remembered
 * width the moment the window shrinks, which is the same mechanism that
 * already rescues a width carried over from an external display.
 */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/**
 * The draggable seam between two panes. Keyboard-operable as well as
 * pointer-operable: it is a control, and on a lectern a trackpad drag is the
 * fiddliest possible way to work one.
 */
export function Grip(props: {
  label: string;
  onDrag: (deltaPx: number) => void;
  onReset: () => void;
}): React.JSX.Element {
  const origin = useRef(0);
  const { onDrag } = props;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    origin.current = e.clientX;
    onDrag(0); // marks the starting width
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => onDrag(ev.clientX - origin.current);
    const up = (): void => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div
      className="grip"
      role="separator"
      aria-orientation="vertical"
      aria-label={`${props.label} width — drag, or arrow keys`}
      tabIndex={0}
      title={`${props.label} width — drag, arrow keys, or double-click to reset`}
      onPointerDown={onPointerDown}
      onDoubleClick={props.onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") {
          onDrag(0);
          onDrag(-step);
        } else if (e.key === "ArrowRight") {
          onDrag(0);
          onDrag(step);
        } else if (e.key === "Home") {
          props.onReset();
        } else {
          return;
        }
        e.preventDefault();
      }}
    >
      <span className="grip-line" aria-hidden="true" />
    </div>
  );
}
