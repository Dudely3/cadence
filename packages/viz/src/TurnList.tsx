import type { Turn } from "@cadence/core";
import { fmtTokens } from "./anatomy";

/**
 * The requests column: pick a turn, and see what that turn's request cost.
 *
 * These used to be two controls — a list on the left and a bar chart in a
 * footer — doing the same job in two places. Measured at 1600x900 with a
 * two-turn run: the list was 240x650 holding 52px of rows, the footer was
 * 1564x150 holding 120px of bars. Both about 90% empty, in opposite
 * directions, and both were turn pickers. Merged, the footer's 150px goes to
 * the block stack, which in the three-pane split had only 396px of height —
 * the pane the whole talk points at.
 *
 * The bar per row is the same four series as before (cache read / write /
 * fresh input / output) on a scale shared across the run, so a growing prompt
 * still reads as a staircase — running down the column rather than across the
 * bottom. The numbers are also text on every row, which is the accessibility
 * relief for the two light-mode series that sit under 3:1.
 */

const SERIES = [
  { key: "cacheRead", label: "read", varName: "--series-1" },
  { key: "cacheWrite", label: "write", varName: "--series-2" },
  { key: "freshIn", label: "fresh", varName: "--series-3" },
  { key: "output", label: "out", varName: "--series-4" },
] as const;

interface Usage {
  cacheRead: number;
  cacheWrite: number;
  freshIn: number;
  output: number;
  total: number;
}

function usageOf(turn: Turn): Usage | null {
  const u = turn.usage;
  if (!u) return null;
  const cacheRead = u.cacheReadTokens ?? 0;
  const cacheWrite = u.cacheWriteTokens ?? 0;
  return {
    cacheRead,
    cacheWrite,
    freshIn: u.inputTokens,
    output: u.outputTokens,
    total: cacheRead + cacheWrite + u.inputTokens + u.outputTokens,
  };
}

function Row(props: {
  turn: Turn;
  usage: Usage | null;
  /** Largest total in the run — the shared scale that makes the staircase. */
  peak: number;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { turn, usage, peak } = props;
  const firstTool = turn.actions[0]?.tool ?? (turn.closed ? "(no tool call)" : "…");
  const more = turn.actions.length > 1 ? ` +${turn.actions.length - 1}` : "";
  const segs = usage
    ? SERIES.map((s) => ({ ...s, value: usage[s.key] })).filter((s) => s.value > 0)
    : [];
  const title = usage
    ? `turn ${turn.index} — ${SERIES.map((s) => `${s.label} ${fmtTokens(usage[s.key])}`).join(" · ")}`
    : `turn ${turn.index} — no model call`;

  return (
    <button
      className={`turn-row${props.selected ? " turn-row-selected" : ""}`}
      onClick={props.onSelect}
      title={title}
    >
      <span className="turn-row-line">
        <span className="turn-row-index">{turn.index}</span>
        <span className="turn-row-tool">
          {firstTool}
          {more}
          {!turn.closed && <span className="live-dot" title="turn in flight" />}
        </span>
        <span className="turn-row-stats">{usage ? fmtTokens(usage.total) : "—"}</span>
      </span>
      {/* The track is always rendered, even with nothing in it, so rows stay
          the same height — a replay's turns cost nothing and would otherwise
          make the list jump as it grows. */}
      <span className="turn-bar" aria-hidden="true">
        {segs.map((s) => (
          <span
            key={s.key}
            className="turn-bar-seg"
            style={{
              width: `${peak === 0 ? 0 : (s.value / peak) * 100}%`,
              background: `var(${s.varName})`,
            }}
          />
        ))}
      </span>
    </button>
  );
}

export function TurnList(props: {
  turns: Turn[];
  selected: number;
  follow: boolean;
  onToggleFollow: () => void;
  onSelect: (index: number) => void;
}): React.JSX.Element {
  const usages = props.turns.map(usageOf);
  const peak = Math.max(0, ...usages.map((u) => u?.total ?? 0));

  return (
    <aside className="turns">
      <div className="pane-title">
        requests
        {peak > 0 && <span className="turns-peak">peak {fmtTokens(peak)}</span>}
        <button
          className={`follow${props.follow ? " follow-on" : ""}`}
          onClick={props.onToggleFollow}
          title="jump to the newest request as it arrives (f)"
        >
          {props.follow ? "following" : "follow"}
        </button>
      </div>
      {props.turns.map((t, i) => (
        <Row
          key={t.index}
          turn={t}
          usage={usages[i] ?? null}
          peak={peak}
          selected={t.index === props.selected}
          onSelect={() => props.onSelect(t.index)}
        />
      ))}
      {props.turns.length === 0 && (
        <p className="hint">request 0 below is about to be sent…</p>
      )}
      {peak > 0 && (
        <div className="turns-legend">
          {SERIES.map((s) => (
            <span className="legend-item" key={s.key}>
              <span className="legend-swatch" style={{ background: `var(${s.varName})` }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}
