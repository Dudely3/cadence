import { useCallback, useEffect, useState } from "react";
import type { Session } from "@cadence/core";
import {
  SLIDES,
  parseMarkdown,
  resolvePlaceholders,
  slideAssetUrl,
  slideValues,
  type Block,
  type Inline,
} from "./slideDeck";
import type { TraceFileInfo } from "./trace";

/** Talk slides, rendered from `slides/*.md` beside the live anatomy. */

function Spans(props: { spans: Inline[] }): React.JSX.Element {
  return (
    <>
      {props.spans.map((s, i) =>
        s.code ? (
          <code key={i}>{s.text}</code>
        ) : s.bold ? (
          <strong key={i}>{s.text}</strong>
        ) : s.italic ? (
          <em key={i}>{s.text}</em>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function BlockView(props: { block: Block }): React.JSX.Element | null {
  const b = props.block;
  switch (b.kind) {
    case "h1":
      return <h1 className="sl-h1"><Spans spans={b.spans} /></h1>;
    case "h2":
      return <h2 className="sl-h2"><Spans spans={b.spans} /></h2>;
    case "h3":
      return <h3 className="sl-h3"><Spans spans={b.spans} /></h3>;
    case "p":
      return <p className="sl-p"><Spans spans={b.spans} /></p>;
    case "quote":
      return <blockquote className="sl-quote"><Spans spans={b.spans} /></blockquote>;
    case "ul":
      return (
        <ul className="sl-ul">
          {b.items.map((it, i) => (
            <li key={i}><Spans spans={it} /></li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="sl-ul sl-ol">
          {b.items.map((it, i) => (
            <li key={i}><Spans spans={it} /></li>
          ))}
        </ol>
      );
    case "code":
      return <pre className="sl-code">{b.text}</pre>;
    case "img": {
      const url = slideAssetUrl(b.src);
      // Say it out loud rather than rendering a broken-image glyph. The only
      // way here is a file that was renamed or never committed, and the name
      // is the one piece of information that makes that fixable.
      if (url === undefined) return <p className="sl-img-missing">missing image: {b.src}</p>;
      return <img className="sl-img" src={url} alt={b.alt} />;
    }
    case "hr":
      return <hr className="sl-hr" />;
    case "table":
      return (
        <div className="sl-table-wrap">
          <table className="sl-table">
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}><Spans spans={c} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, k) => (
                    <td key={k}><Spans spans={c} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

/** "ladder-3-cleaned · 2 turns ✓" — the chip has to be readable at a glance. */
function chipLabel(name: string, info: TraceFileInfo | undefined): string {
  const id = name.replace(/\.json$/, "");
  if (!info?.goalId) return id;
  const mark =
    info.outcome === "completed" ? "✓" : info.outcome === "error" ? "✕" : info.outcome === "max_steps" ? "⏱" : "";
  return `${info.goalId} · ${info.turns ?? 0} turns ${mark}`.trim();
}

/**
 * The recordings this slide is about. Clicking one opens it in the anatomy
 * beside the slide; the ✕ removes a run this machine added (frontmatter
 * bindings travel with the talk and are edited in the file, not here).
 */
function SessionStrip(props: {
  sessions: string[];
  pinned: string[];
  traces: TraceFileInfo[];
  current: string;
  onOpen: (name: string) => void;
  onUnpin: (name: string) => void;
}): React.JSX.Element | null {
  if (props.sessions.length === 0) return null;
  const byName = new Map(props.traces.map((t) => [t.name, t]));
  return (
    <div className="sl-sessions">
      <span className="sl-sessions-label">sessions</span>
      {props.sessions.map((name) => {
        const info = byName.get(name);
        const missing = info === undefined;
        return (
          <span
            key={name}
            className={`sl-chip${props.current === name ? " sl-chip-open" : ""}${missing ? " sl-chip-missing" : ""}`}
          >
            <button
              className="sl-chip-open-btn"
              onClick={() => props.onOpen(name)}
              disabled={missing}
              title={missing ? `${name} is not in traces/ on this machine` : info.goalDescription}
            >
              {missing ? `${name.replace(/\.json$/, "")} (missing)` : chipLabel(name, info)}
            </button>
            {props.pinned.includes(name) && (
              <button
                className="sl-chip-x"
                onClick={() => props.onUnpin(name)}
                title="forget this recording on this slide"
              >
                ✕
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Slide type scales with the pane on its own (see `.sl-body`), but only up to
 * the size where these slides stop fitting on one screen. Past that it is a
 * judgement about the room — how far back the last row is, how much of the
 * slide the presenter is willing to scroll — so it is a control, not a
 * constant. Remembered, because it is set once per venue.
 */
const ZOOM_KEY = "cadence.slideZoom";
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.2;

function useSlideZoom(): [number, (step: number) => void, () => void] {
  const [zoom, setZoom] = useState(() => {
    try {
      const n = Number(localStorage.getItem(ZOOM_KEY));
      return Number.isFinite(n) && n > 0 ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : 1;
    } catch {
      // Blocked site data must not take the deck down; the default is fine.
      return 1;
    }
  });
  const apply = useCallback((next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 10) / 10));
    setZoom(clamped);
    try {
      localStorage.setItem(ZOOM_KEY, String(clamped));
    } catch {
      /* nothing to do — it just won't be remembered */
    }
  }, []);
  const bump = useCallback((step: number) => setZoom((z) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + step) * 10) / 10));
    try {
      localStorage.setItem(ZOOM_KEY, String(clamped));
    } catch {
      /* as above */
    }
    return clamped;
  }), []);
  return [zoom, bump, () => apply(1)];
}

export function Slides(props: {
  index: number;
  onIndex: (i: number) => void;
  session: Session | undefined;
  /** Recordings bound to the current slide: frontmatter first, then live pins. */
  sessions: string[];
  /** Which of those came from a live run, so only those can be removed. */
  pinned: string[];
  traces: TraceFileInfo[];
  currentTrace: string;
  onOpenSession: (name: string) => void;
  onUnpin: (name: string) => void;
  /** Whether moving between slides also moves the open trace. */
  linked: boolean;
  onToggleLink: () => void;
  /** Open the run panel with this slide's run loaded. */
  onRun: ((index: number) => void) | undefined;
}): React.JSX.Element {
  const total = SLIDES.length;
  const current = SLIDES[Math.min(props.index, Math.max(0, total - 1))];
  const [zoom, bumpZoom, resetZoom] = useSlideZoom();

  // ←/→ move between slides while this panel is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft") props.onIndex(Math.max(0, props.index - 1));
      else if (e.key === "ArrowRight") props.onIndex(Math.min(total - 1, props.index + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, total]);

  if (!current) {
    return (
      <div className="slides">
        <p className="hint">
          No slides found. Add markdown files to <code>slides/</code> — they load in
          filename order and hot-reload as you edit.
        </p>
      </div>
    );
  }

  const values = slideValues(props.session);
  const blocks = parseMarkdown(resolvePlaceholders(current.body, values));
  const unresolved = /\{\{\w+\}\}/.test(resolvePlaceholders(current.body, values));

  return (
    <div className="slides" style={{ "--sl-zoom": zoom } as React.CSSProperties}>
      <div className="sl-bar">
        <button
          className="run-btn"
          onClick={() => props.onIndex(Math.max(0, props.index - 1))}
          disabled={props.index === 0}
        >
          ←
        </button>
        <span className="sl-count">
          {props.index + 1} / {total}
        </span>
        <button
          className="run-btn"
          onClick={() => props.onIndex(Math.min(total - 1, props.index + 1))}
          disabled={props.index >= total - 1}
        >
          →
        </button>
        <select
          className="sl-jump"
          value={props.index}
          onChange={(e) => props.onIndex(Number(e.target.value))}
        >
          {SLIDES.map((s) => (
            <option key={s.name} value={s.index}>
              {/* What each slide carries, at a glance: how many recordings are
                  bound to it, and whether it can launch a run. */}
              {s.index + 1}. {s.title}
              {s.sessions.length > 0 ? ` · ${s.sessions.length} rec` : ""}
              {s.runs.length > 0 ? ` · ${"▶".repeat(s.runs.length)}` : ""}
            </option>
          ))}
        </select>
        <button
          className={`follow${props.linked ? " follow-on" : ""}`}
          onClick={props.onToggleLink}
          title={
            props.linked
              ? "changing slides opens that slide's recording — click to stop"
              : "changing slides leaves the open trace alone — click to link them"
          }
        >
          {props.linked ? "⇄ linked" : "⇄ link"}
        </button>
        {props.onRun &&
          current.runs.map((r, i) => (
            <button
              key={i}
              className="run-btn run-btn-primary"
              onClick={() => props.onRun?.(i)}
              title="load this run"
            >
              ▶ {r.label ?? "run this slide"}
            </button>
          ))}
        {/* Type size for the room. The pane width already sets a sensible
            size; this is the presenter overruling it for the back row. */}
        <span className="sl-zoom">
          <button
            className="run-btn"
            onClick={() => bumpZoom(-0.1)}
            disabled={zoom <= ZOOM_MIN}
            title="smaller slide text"
          >
            A−
          </button>
          <button
            className="sl-zoom-value"
            onClick={resetZoom}
            title="slide text size — click to reset to the size this pane width suggests"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="run-btn"
            onClick={() => bumpZoom(0.1)}
            disabled={zoom >= ZOOM_MAX}
            title="bigger slide text"
          >
            A+
          </button>
        </span>
        {unresolved && (
          <span className="chip chip-warning chip-mini" title="a {{placeholder}} had no value in this trace">
            unresolved value
          </span>
        )}
      </div>

      <SessionStrip
        sessions={props.sessions}
        pinned={props.pinned}
        traces={props.traces}
        current={props.currentTrace}
        onOpen={props.onOpenSession}
        onUnpin={props.onUnpin}
      />

      <article className="sl-body">
        {blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
      </article>
    </div>
  );
}
