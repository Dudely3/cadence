import { useEffect, useMemo, useRef, useState } from "react";
import type { Turn } from "@cadence/core";
import { useTrace, useTraceList, useTraceSummaries, type TraceFileInfo } from "./trace";
import { requestAnatomy, approxTokens, fmtTokens, REGION_LABEL, type AnatomyBlock } from "./anatomy";
import { TokenStrip } from "./TokenStrip";
import { BlockMap } from "./BlockMap";
import { Sessions } from "./Sessions";
import { RunPanel } from "./RunPanel";
import { Slides } from "./Slides";

/** Run-state chip: icon + label always — never color alone. */
function OutcomeChip(props: {
  outcome?: string;
  running: boolean;
  stalled: boolean;
}): React.JSX.Element {
  // A trace with no result isn't necessarily live: a killed run leaves one
  // behind forever. Say "stalled" rather than claiming it's still going.
  if (props.stalled) return <span className="chip chip-serious">■ stalled — no result</span>;
  if (props.running) return <span className="chip chip-running">● running</span>;
  switch (props.outcome) {
    case "completed":
      return <span className="chip chip-good">✓ completed</span>;
    case "error":
      return <span className="chip chip-critical">✕ error</span>;
    case "stopped":
      return <span className="chip chip-serious">■ stopped</span>;
    case "max_steps":
      return <span className="chip chip-warning">⏱ max steps</span>;
    default:
      return <span className="chip">–</span>;
  }
}

function TurnRow(props: {
  turn: Turn;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { turn } = props;
  const firstTool = turn.actions[0]?.tool ?? (turn.closed ? "(no tool call)" : "…");
  const more = turn.actions.length > 1 ? ` +${turn.actions.length - 1}` : "";
  return (
    <button className={`turn-row${props.selected ? " turn-row-selected" : ""}`} onClick={props.onSelect}>
      <span className="turn-row-index">{turn.index}</span>
      <span className="turn-row-tool">
        {firstTool}
        {more}
        {!turn.closed && <span className="live-dot" title="turn in flight" />}
      </span>
      <span className="turn-row-stats">
        {turn.usage
          ? `${fmtTokens((turn.usage.cacheReadTokens ?? 0) + turn.usage.inputTokens)}→${fmtTokens(turn.usage.outputTokens)}`
          : "—"}
      </span>
    </button>
  );
}

function BlockCard(props: {
  block: AnatomyBlock;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { block } = props;
  return (
    <button
      className={`block block-${block.region}${props.selected ? " block-selected" : ""}`}
      onClick={props.onSelect}
      title={REGION_LABEL[block.region]}
    >
      <span className="block-role">{block.role}</span>
      <span className="block-label">
        {block.label}
        {block.isError && <span className="chip chip-critical chip-mini">✕ error</span>}
      </span>
      <span className="block-tokens">~{fmtTokens(approxTokens(block.chars))} tok</span>
      {block.breakpoint && <span className="block-bp" title="cache_control breakpoint on the wire">❄</span>}
    </button>
  );
}

/** "shop-cheapest-camping · accuracy · 3 turns" — a filename tells you nothing. */
function describeTrace(f: TraceFileInfo): string {
  if (f.name === "live.json") return `live.json${f.goalId ? ` · ${f.goalId}` : ""}`;
  if (!f.goalId) return f.name;
  return `${f.goalId} · ${f.mode ?? "?"} · ${f.turns ?? 0} turns`;
}

export function App(): React.JSX.Element {
  const files = useTraceList();
  const summaries = useTraceSummaries(files);
  const [traceName, setTraceName] = useState("live.json");
  const [follow, setFollow] = useState(true);
  const [turnIndex, setTurnIndex] = useState(0);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [view, setView] = useState<"anatomy" | "blocks">("anatomy");
  const [showSessions, setShowSessions] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [showSlides, setShowSlides] = useState(false);
  const [slide, setSlide] = useState(0);

  // The listing carries only file stats; fold in each session's summary so the
  // picker and the Sessions view can describe a run instead of naming a file.
  const described = useMemo<TraceFileInfo[]>(
    () => files.map((f) => ({ ...f, ...summaries.get(f.name) })),
    [files, summaries],
  );

  const { envelope, stale } = useTrace(traceName);
  const session = envelope?.session;
  const turns = session?.turns ?? [];
  const latest = Math.max(0, turns.length - 1);
  const selected = follow ? latest : Math.min(turnIndex, latest);

  const running = envelope !== null && envelope.result === undefined;

  // Re-render on a timer while a trace looks live, so "running" can decay into
  // "stalled" — the file itself stops changing, so polling alone never notices.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, [running]);
  const STALL_MS = 15_000;
  const stalled = running && envelope !== null && now - envelope.writtenAt > STALL_MS;
  // Re-arm follow whenever a NEW run appears, however it was started. Without
  // this, a viewer left on a finished trace has follow released and stays
  // pinned to turn 0 while the new run streams in behind it — exactly what
  // happens when the run is launched from a terminal instead of the run panel.
  const seenSession = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = session?.id;
    if (!id || seenSession.current === id) return;
    seenSession.current = id;
    if (running) {
      setFollow(true);
      setTurnIndex(0);
      setBlockId(null);
    }
  }, [session?.id, running]);

  // A finished trace has nothing left to follow — release auto-follow so the
  // stepper is fully manual on recordings. Two details matter:
  //   - Leave the view on the LAST turn. Falling back to a turnIndex captured
  //     before the run would snap the panel back to turn 0 as the run ended.
  //   - Release ONCE per run. This effect re-runs when `follow` changes, so
  //     releasing unconditionally would undo a manual re-enable instantly and
  //     make the follow toggle look broken.
  const releasedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!envelope || running) return;
    const id = envelope.session.id;
    if (releasedFor.current === id) return;
    releasedFor.current = id;
    if (follow) setTurnIndex(Math.max(0, envelope.session.turns.length - 1));
    setFollow(false);
  }, [envelope, running, follow]);

  const anatomy = useMemo(
    () => (session ? requestAnatomy(session, selected) : null),
    [session, selected],
  );
  const selectedBlock =
    anatomy?.blocks.find((b) => b.id === blockId) ??
    anatomy?.response.find((b) => b.id === blockId) ??
    null;

  const pick = (i: number): void => {
    setFollow(false);
    setTurnIndex(i);
    setBlockId(null);
  };

  /** Toggle follow without moving the view: dropping follow keeps this turn. */
  const toggleFollow = (): void => {
    if (follow) {
      setTurnIndex(selected);
      setFollow(false);
    } else {
      setFollow(true);
    }
  };

  // ←/→ scrub turns (great on stage); v toggles the presentation view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never steal keys from the goal box or any other text field.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT")) {
        return;
      }
      if (e.key === "s") setShowSessions((v) => !v);
      else if (e.key === "r") setShowRun((v) => !v);
      else if (e.key === "d") setShowSlides((v) => !v);
      else if (e.key === "Escape") {
        setShowSessions(false);
        setShowRun(false);
        setShowSlides(false);
      } else if (showSessions || showRun || showSlides) return; // a panel owns the arrows
      else if (e.key === "ArrowLeft") pick(Math.max(0, selected - 1));
      else if (e.key === "ArrowRight") pick(Math.min(latest, selected + 1));
      else if (e.key === "v") setView((v) => (v === "anatomy" ? "blocks" : "anatomy"));
      else if (e.key === "f") toggleFollow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, latest, showSessions, showRun, showSlides, follow]);

  if (!session) {
    return (
      <div className="viz-root empty-state">
        <h1>cadence · context anatomy</h1>
        <p>
          No trace yet{stale ? " (waiting for traces/)" : ""}. Run <code>npm run spike</code> in a
          terminal — this page tails <code>traces/live.json</code> and draws each request as it happens.
        </p>
      </div>
    );
  }

  // The anatomy view is happy to grow and let the page scroll. The run and
  // sessions panels must NOT: their controls have to stay on screen while the
  // log or list scrolls inside them, and .viz-root's min-height:100vh would
  // otherwise let tall content push the header away.
  const panelOpen = showRun || showSessions || showSlides;

  return (
    <div className={`viz-root${panelOpen ? " viz-root-fixed" : ""}`}>
      <header className="head">
        <h1>cadence · context anatomy</h1>
        <button
          className={`follow${showSlides ? " follow-on" : ""}`}
          onClick={() => {
            setShowSlides((v) => !v);
            setShowSessions(false);
          }}
          title="talk slides (d)"
        >
          ▤ slides
        </button>
        <button
          className={`follow${showRun ? " follow-on" : ""}`}
          onClick={() => {
            setShowRun((v) => !v);
            setShowSessions(false);
          }}
          title="run an agent (r)"
        >
          ▶ run
        </button>
        <button
          className={`follow${showSessions ? " follow-on" : ""}`}
          onClick={() => {
            setShowSessions((v) => !v);
            setShowRun(false);
          }}
          title="all sessions (s)"
        >
          ☰ sessions
        </button>
        <select value={traceName} onChange={(e) => setTraceName(e.target.value)}>
          {!files.some((f) => f.name === traceName) && <option value={traceName}>{traceName}</option>}
          {described.map((f) => (
            <option key={f.name} value={f.name}>
              {describeTrace(f)}
            </option>
          ))}
        </select>
        <button
          className={`follow${follow ? " follow-on" : ""}`}
          onClick={toggleFollow}
          title={
            follow
              ? "following the newest turn — click to pin this one (f)"
              : "pinned to one turn — click to follow the newest (f)"
          }
        >
          {follow ? "⤓ following" : "⤓ follow"}
        </button>
        <button
          className="follow"
          onClick={() => setView(view === "anatomy" ? "blocks" : "anatomy")}
          title="toggle presentation view (v)"
        >
          {view === "anatomy" ? "▦ blocks" : "☰ anatomy"}
        </button>
        <OutcomeChip
          {...(envelope.result ? { outcome: envelope.result.outcome } : {})}
          running={running}
          stalled={stalled}
        />
        <span className="chip">{session.mode} mode</span>
        <span className="goal" title={session.goal.description}>
          {session.goal.description}
        </span>
      </header>

      {showSessions ? (
        <Sessions
          files={described}
          current={traceName}
          onOpen={(name) => {
            setTraceName(name);
            setShowSessions(false);
            setShowRun(false);
            setFollow(name === "live.json");
            setTurnIndex(0);
            setBlockId(null);
          }}
        />
      ) : (
        <div className={showRun || showSlides ? "split" : "solo"}>
          {showSlides && <Slides index={slide} onIndex={setSlide} session={session} />}
          {/* Run controls sit BESIDE the anatomy, not instead of it: the point
              of stepping is watching the context grow as each turn lands. */}
          {showRun && (
            <RunPanel
              onRunStarted={() => {
                // A new run streams into live.json — follow it as it happens.
                setTraceName("live.json");
                setFollow(true);
                setTurnIndex(0);
                setBlockId(null);
              }}
            />
          )}
          {/* One grid child per column: everything on the anatomy side lives in
              this pane, or auto-placement scatters it across the split. */}
          <div className="main-pane">
          {turns.length === 0 && (
            <p className="hint empty-trace">
              {stalled
                ? `This run recorded no turns and stopped without finishing — it was probably killed. Open a recording from ☰ sessions, or start a new run.`
                : `Waiting for the first turn to land…`}
            </p>
          )}
          {view === "blocks" ? (
        <div className="present">
          <div className="present-head">
            {session.mode === "replay" ? `turn ${selected} · replay — no model requests` : `request for turn ${selected}`}
            <span className="hint"> · ← → scrub turns · v for detail view</span>
          </div>
          {anatomy && <BlockMap anatomy={anatomy} />}
          <div className="present-legend">
            <span className="legend-item">
              <span className="legend-swatch swatch-cached" /> cached
            </span>
            <span className="legend-item">
              <span className="legend-swatch swatch-write" /> freezing now
            </span>
            <span className="legend-item">
              <span className="legend-swatch swatch-fresh" /> fresh
            </span>
            <span className="legend-item">
              <span className="legend-swatch swatch-response" /> response
            </span>
          </div>
        </div>
      ) : (
      <div className="columns">
        <aside className="turns">
          <div className="pane-title">
            requests
            <button
              className={`follow${follow ? " follow-on" : ""}`}
              onClick={toggleFollow}
              title="jump to the newest request as it arrives (f)"
            >
              {follow ? "following" : "follow"}
            </button>
          </div>
          {turns.map((t) => (
            <TurnRow key={t.index} turn={t} selected={t.index === selected} onSelect={() => pick(t.index)} />
          ))}
          {turns.length === 0 && <p className="hint">request 0 below is about to be sent…</p>}
        </aside>

        <section className="stack">
          <div className="pane-title">
            {session.mode === "replay"
              ? `turn ${selected} — REPLAY: no request was sent to any model; actions re-executed from the trace`
              : `request for turn ${selected} — exactly what went on the wire`}
          </div>
          {anatomy?.blocks.map((b, i) => (
            <div key={b.id}>
              <BlockCard block={b} selected={b.id === blockId} onSelect={() => setBlockId(b.id)} />
              {i === anatomy.cacheLineAt && (
                <div className="cache-line" title="cache_control breakpoint — the prefix above this line is frozen">
                  ❄ cache line — everything above is frozen
                </div>
              )}
            </div>
          ))}
          <div className="pane-title response-title">response — what came back</div>
          {anatomy?.response.map((b) => (
            <BlockCard key={b.id} block={b} selected={b.id === blockId} onSelect={() => setBlockId(b.id)} />
          ))}
          {anatomy?.responsePending && <p className="hint">response pending…</p>}
          {anatomy && !anatomy.responsePending && anatomy.response.length === 0 && (
            <p className="hint">no turn recorded for this request yet</p>
          )}
          {anatomy?.turn?.usage && (
            <div className="usage-note">
              actual usage · cache read {fmtTokens(anatomy.turn.usage.cacheReadTokens ?? 0)} · cache
              write {fmtTokens(anatomy.turn.usage.cacheWriteTokens ?? 0)} · fresh in{" "}
              {fmtTokens(anatomy.turn.usage.inputTokens)} · out {fmtTokens(anatomy.turn.usage.outputTokens)} ·{" "}
              {anatomy.turn.timing.durationMs} ms
            </div>
          )}
        </section>

        <aside className="detail">
          <div className="pane-title">block detail</div>
          {selectedBlock ? (
            <>
              <div className="detail-meta">
                <span className="chip">{selectedBlock.role}</span>
                <span className="chip">{REGION_LABEL[selectedBlock.region]}</span>
                <span className="chip">
                  {selectedBlock.chars} chars · ~{fmtTokens(approxTokens(selectedBlock.chars))} tok
                </span>
                {selectedBlock.breakpoint && <span className="chip">❄ breakpoint</span>}
              </div>
              <pre className="detail-body">{selectedBlock.body}</pre>
            </>
          ) : (
            <p className="hint">click a block to see exactly what's in it</p>
          )}
        </aside>
      </div>
          )}
          </div>
        </div>
      )}

      {view === "anatomy" && (
        <footer>
          <TokenStrip turns={turns} selected={selected} onSelect={pick} />
        </footer>
      )}
    </div>
  );
}
