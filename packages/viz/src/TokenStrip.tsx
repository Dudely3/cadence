import type { Turn } from "@cadence/core";
import { fmtTokens } from "./anatomy";

/**
 * Per-request token composition: cache read / cache write / fresh input /
 * output, one stacked bar per turn. This is the "an N-turn run costs ~O(1)
 * fresh input per turn" claim, drawn from real usage numbers.
 *
 * Palette: categorical slots 1–4 in fixed stack order (adjacent pairs
 * validated for CVD in both modes). The turn sidebar carries the same numbers
 * as text — the relief for the two light-mode sub-3:1 slots.
 */

const SERIES = [
  { key: "cacheRead", label: "cache read", varName: "--series-1" },
  { key: "cacheWrite", label: "cache write", varName: "--series-2" },
  { key: "freshIn", label: "fresh input", varName: "--series-3" },
  { key: "output", label: "output", varName: "--series-4" },
] as const;

interface BarData {
  index: number;
  cacheRead: number;
  cacheWrite: number;
  freshIn: number;
  output: number;
  total: number;
}

function toBar(turn: Turn): BarData | null {
  if (!turn.usage) return null;
  const cacheRead = turn.usage.cacheReadTokens ?? 0;
  const cacheWrite = turn.usage.cacheWriteTokens ?? 0;
  const freshIn = turn.usage.inputTokens;
  const output = turn.usage.outputTokens;
  return { index: turn.index, cacheRead, cacheWrite, freshIn, output, total: cacheRead + cacheWrite + freshIn + output };
}

/** Rect with only its top corners rounded — the data-end, anchored to the stack. */
function topRoundedPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

export function TokenStrip(props: {
  turns: Turn[];
  selected: number;
  onSelect: (index: number) => void;
}): React.JSX.Element | null {
  const bars = props.turns.map(toBar).filter((b): b is BarData => b !== null);
  if (bars.length === 0) return null;

  const H = 96;
  const BAR_W = 26;
  const GAP = 10;
  const PAD_L = 44;
  const PAD_B = 18;
  const SEG_GAP = 2; // surface gap between stacked segments
  const max = Math.max(...bars.map((b) => b.total));
  const width = PAD_L + bars.length * (BAR_W + GAP);
  const scale = (v: number): number => (max === 0 ? 0 : (v / max) * (H - 8));

  return (
    <div className="strip">
      <div className="strip-head">
        <span className="strip-title">tokens per request</span>
        <span className="legend">
          {SERIES.map((s) => (
            <span className="legend-item" key={s.key}>
              <span className="legend-swatch" style={{ background: `var(${s.varName})` }} />
              {s.label}
            </span>
          ))}
        </span>
      </div>
      <svg width={width} height={H + PAD_B} role="img" aria-label="Token composition per request">
        {/* baseline */}
        <line x1={PAD_L - 6} y1={H} x2={width} y2={H} className="axis-line" />
        <text x={PAD_L - 10} y={12} className="axis-label" textAnchor="end">
          {fmtTokens(max)}
        </text>
        <text x={PAD_L - 10} y={H} className="axis-label" textAnchor="end">
          0
        </text>
        {bars.map((b, i) => {
          const x = PAD_L + i * (BAR_W + GAP);
          const segs = SERIES.map((s) => ({ ...s, value: b[s.key] })).filter((s) => s.value > 0);
          let y = H;
          const isSelected = b.index === props.selected;
          return (
            <g
              key={b.index}
              className={`bar${isSelected ? " bar-selected" : ""}`}
              onClick={() => props.onSelect(b.index)}
            >
              {/* hover/hit target larger than the marks */}
              <rect x={x - GAP / 2} y={0} width={BAR_W + GAP} height={H + PAD_B} fill="transparent">
                <title>
                  {`turn ${b.index} — ${SERIES.map((s) => `${s.label} ${fmtTokens(b[s.key])}`).join(" · ")}`}
                </title>
              </rect>
              {segs.map((s, si) => {
                const h = Math.max(scale(s.value), 1.5);
                y -= h;
                const isTop = si === segs.length - 1;
                const yy = y;
                y -= SEG_GAP;
                return isTop ? (
                  <path key={s.key} d={topRoundedPath(x, yy, BAR_W, h, 4)} style={{ fill: `var(${s.varName})` }} />
                ) : (
                  <rect key={s.key} x={x} y={yy} width={BAR_W} height={h} style={{ fill: `var(${s.varName})` }} />
                );
              })}
              <text x={x + BAR_W / 2} y={H + 14} className="axis-label" textAnchor="middle">
                {b.index}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
