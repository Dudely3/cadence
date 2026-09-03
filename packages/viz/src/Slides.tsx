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

/** Talk slides, rendered from `slides/*.md` beside the live anatomy. */

function Spans(props: { spans: Inline[] }): React.JSX.Element {
  return (
    <>
      {props.spans.map((s, i) =>
        s.code ? (
          <code key={i}>{s.text}</code>
        ) : s.bold ? (
          <strong key={i}>{s.text}</strong>
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

export function Slides(props: {
  index: number;
  onIndex: (i: number) => void;
  session: Session | undefined;
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
              {s.index + 1}. {s.title}
            </option>
          ))}
        </select>
        {unresolved && (
          <span className="chip chip-warning chip-mini" title="a {{placeholder}} had no value in this trace">
            unresolved value
          </span>
        )}
      </div>

      <article className="sl-body">
        {blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
      </article>
    </div>
  );
}
