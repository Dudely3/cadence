import { useEffect, useState } from "react";
import { fmtTokens, REGION_LABEL, type AnatomyBlock, type RequestAnatomy } from "./anatomy";

/**
 * Presentation view: the request as colored blocks — one quiet label per
 * block, height ∝ tokens (sqrt-compressed), color = cache region, one
 * prominent line where the breakpoint sits. Click a block to read what's
 * inside it; Escape (or click again) closes.
 */
export function BlockMap(props: { anatomy: RequestAnatomy }): React.JSX.Element {
  const { blocks, cacheLineAt } = props.anatomy;
  const [openId, setOpenId] = useState<string | null>(null);

  // Scrubbing to another turn rebuilds the block list — close the reader.
  useEffect(() => {
    setOpenId(null);
  }, [props.anatomy.turnIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const response = props.anatomy.response;
  const weights = blocks.map((b) => Math.sqrt(b.tokens));
  const rWeights = response.map((b) => Math.sqrt(b.tokens));
  const open: AnatomyBlock | undefined =
    blocks.find((b) => b.id === openId) ?? response.find((b) => b.id === openId);

  const renderBlock = (b: AnatomyBlock): React.JSX.Element => (
    <button
      className={`blockmap-block blockmap-${b.region}${b.id === openId ? " blockmap-open" : ""}`}
      onClick={() => setOpenId(b.id === openId ? null : b.id)}
      title={
        b.region === "result"
          ? `${REGION_LABEL[b.region]} — ~${fmtTokens(b.tokens)} tok, charged on the next request`
          : `${REGION_LABEL[b.region]} — ${b.exact ? "" : "~"}${fmtTokens(b.tokens)} tok`
      }
    >
      <span className="blockmap-label">
        {b.label}
        {b.isError && " ✕"}
        {b.breakpoint && " ❄"}
      </span>
      <span className="blockmap-tok">{b.exact ? "" : "~"}{fmtTokens(b.tokens)}</span>
    </button>
  );

  return (
    <div className="blockmap-wrap">
      <div className="blockmap">
        {blocks.map((b, i) => (
          <div key={b.id} className="blockmap-item" style={{ flexGrow: weights[i] ?? 1 }}>
            {renderBlock(b)}
            {i === cacheLineAt && (
              <div className="blockmap-line" title="cache breakpoint — everything above is frozen">
                <span>❄</span>
              </div>
            )}
          </div>
        ))}

        <div className="blockmap-divider">▼ response</div>
        {response.map((b, i) => (
          <div key={b.id} className="blockmap-item" style={{ flexGrow: rWeights[i] ?? 1 }}>
            {renderBlock(b)}
          </div>
        ))}
        {props.anatomy.responsePending && <div className="blockmap-divider">response pending…</div>}
      </div>

      {open && (
        <div className="blockmap-reader">
          <div className="blockmap-reader-head">
            <span className={`reader-dot blockmap-${open.region}`} />
            <strong>{open.label}</strong>
            <span className="hint">{REGION_LABEL[open.region]} · {open.exact ? "" : "~"}{fmtTokens(open.tokens)} tok · esc to close</span>
          </div>
          <pre className="blockmap-reader-body">
            {open.body.length > 6000 ? `${open.body.slice(0, 6000)}\n\n… (${open.chars - 6000} more chars — see anatomy view)` : open.body}
          </pre>
        </div>
      )}
    </div>
  );
}
