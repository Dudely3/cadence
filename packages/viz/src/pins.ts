import { useCallback, useEffect, useState } from "react";

/**
 * Slide → recordings, the half that is written at runtime.
 *
 * A slide's frontmatter names the recordings the talk was built on. This is
 * the other half: what live runs added, kept in `slides/pins.json` by the
 * control server. Two stores because they have two authors — one is edited in
 * the markdown, the other by pressing start.
 *
 * With the control server off (a built, static viewer) every call here fails
 * quietly and the authored bindings still work.
 */
export type Pins = Record<string, string[]>;

export function usePins(): {
  pins: Pins;
  /** Re-read the file — after a run, which pins itself server-side. */
  refresh: () => Promise<void>;
  unpin: (slide: string, trace: string) => Promise<void>;
} {
  const [pins, setPins] = useState<Pins>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/control/pins");
      if (res.ok) setPins((await res.json()) as Pins);
    } catch {
      /* no control server — authored bindings are still there */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (route: "unpin", slide: string, trace: string[]) => {
      try {
        const res = await fetch(`/control/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slide, trace }),
        });
        const out = (await res.json()) as { pins?: Pins };
        // Take the server's map back rather than patching locally: it owns the
        // file, and it de-duplicates.
        if (out.pins) setPins(out.pins);
        else await load();
      } catch {
        /* nothing to pin to */
      }
    },
    [load],
  );

  return {
    pins,
    refresh: load,
    unpin: useCallback((slide, trace) => send("unpin", slide, [trace]), [send]),
  };
}
