import { relativeTime, type SessionSummary } from "@cadence/core";
import { fmtTokens } from "./anatomy";
import type { TraceFileInfo } from "./trace";

/**
 * Session overview: every recording on disk, described well enough to pick one
 * without opening it. Session ids (`sess_mtes6cyx_1`) say nothing on their own,
 * so each row leads with the goal, the mode, and what the run actually did.
 */

function outcomeChip(t: TraceFileInfo): React.JSX.Element {
  if (t.outcome === undefined) return <span className="chip">unreadable</span>;
  switch (t.outcome) {
    case "completed":
      return t.success ? (
        <span className="chip chip-good">✓ completed</span>
      ) : (
        <span className="chip chip-warning">✓ completed (not success)</span>
      );
    case "error":
      return <span className="chip chip-critical">✕ error</span>;
    case "stopped":
      return <span className="chip chip-serious">■ stopped</span>;
    case "max_steps":
      return <span className="chip chip-warning">⏱ max steps</span>;
    case "unfinished":
      return <span className="chip chip-running">● running / unfinished</span>;
    default:
      return <span className="chip">{t.outcome}</span>;
  }
}

function SessionRow(props: {
  trace: TraceFileInfo;
  current: boolean;
  isLatestForGoal: boolean;
  pinned?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const t = props.trace;
  const cost = t.costUsd !== undefined && t.costUsd > 0 ? `$${t.costUsd.toFixed(4)}` : "free";
  return (
    <button
      className={`session-row${props.current ? " session-row-current" : ""}`}
      onClick={props.onOpen}
      title={t.goalDescription ?? t.name}
    >
      <div className="session-head">
        <span className="session-goal">{t.goalId ?? t.name}</span>
        <span className="session-mode">{t.mode ?? "?"}</span>
        {outcomeChip(t)}
        {props.pinned && <span className="chip chip-mini chip-good">📌 pinned</span>}
        {props.isLatestForGoal && <span className="chip chip-mini">latest</span>}
        {props.current && <span className="chip chip-mini">open</span>}
        <span className="session-when">
          {t.startedMs !== undefined ? relativeTime(t.startedMs) : ""}
        </span>
      </div>
      <div className="session-story">{t.storyline ?? "—"}</div>
      <div className="session-stats">
        <span>{t.turns ?? 0} turns</span>
        <span>{t.llmCalls ?? 0} calls</span>
        {t.wallMs !== undefined && t.wallMs > 0 && <span>{(t.wallMs / 1000).toFixed(1)}s</span>}
        <span>{cost}</span>
        {t.cacheReadTokens !== undefined && t.cacheReadTokens > 0 && (
          <span className="session-cache">{fmtTokens(t.cacheReadTokens)} cache-read</span>
        )}
        <span className="session-id">{t.name.replace(/\.json$/, "")}</span>
      </div>
    </button>
  );
}

export function Sessions(props: {
  files: TraceFileInfo[];
  current: string;
  onOpen: (name: string) => void;
}): React.JSX.Element {
  // `live.json` is the run in progress, not a recording — pin it to the top.
  const live = props.files.find((f) => f.name === "live.json");
  // `pinned.json` is a COPY of another recording (see examples/pin.ts). Listing
  // it would double-show that run, so mark the original instead.
  const pinnedId = props.files.find((f) => f.name === "pinned.json")?.id;
  const rest = props.files.filter((f) => f.name !== "live.json" && f.name !== "pinned.json");

  // Mark the newest completed run per goal — what `--replay latest` resolves to.
  const latestForGoal = new Set<string>();
  const seen = new Set<string>();
  for (const f of rest) {
    if (f.outcome === "completed" && f.goalId && !seen.has(f.goalId)) {
      seen.add(f.goalId);
      latestForGoal.add(f.name);
    }
  }

  return (
    <div className="sessions">
      <p className="hint">
        Every trace in <code>traces/</code>. Click one to open it in the anatomy view.
        Pin the stage fallback from a terminal with <code>npm run pin</code>.
      </p>
      {live && (
        <>
          <h2 className="sessions-heading">Live</h2>
          <SessionRow
            trace={live}
            current={props.current === live.name}
            isLatestForGoal={false}
            onOpen={() => props.onOpen(live.name)}
          />
        </>
      )}
      <h2 className="sessions-heading">Recordings ({rest.length})</h2>
      {rest.length === 0 && <p className="hint">No recordings yet — a finished run writes one.</p>}
      {rest.map((f) => (
        <SessionRow
          key={f.name}
          trace={f}
          current={props.current === f.name}
          isLatestForGoal={latestForGoal.has(f.name)}
          pinned={f.id !== undefined && f.id === pinnedId}
          onOpen={() => props.onOpen(f.name)}
        />
      ))}
    </div>
  );
}
