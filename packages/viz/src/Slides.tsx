import { useEffect } from "react";
import type { Session } from "@cadence/core";
import {
  SLIDES,
  parseMarkdown,
  resolvePlaceholders,
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
  onRun: (() => void) | undefined;
}): React.JSX.Element {
  const total = SLIDES.length;
  const current = SLIDES[Math.min(props.index, Math.max(0, total - 1))];

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
    <div className="slides">
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
              {s.run ? " · ▶" : ""}
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
        {current.run && props.onRun && (
          <button className="run-btn run-btn-primary" onClick={props.onRun} title="load this slide's run">
            ▶ {current.run.label ?? "run this slide"}
          </button>
        )}
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
