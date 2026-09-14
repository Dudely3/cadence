import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTrace, useTraceList, useTraceSummaries, type TraceFileInfo } from "./trace";
import { requestAnatomy, fmtTokens, REGION_LABEL, type AnatomyBlock } from "./anatomy";
import { TurnList } from "./TurnList";
import { BlockMap } from "./BlockMap";
import { Sessions } from "./Sessions";
import { RunPanel } from "./RunPanel";
import { Slides } from "./Slides";
import { SLIDES, slidesForTrace } from "./slideDeck";
import { usePins } from "./pins";
import { Grip, usePaneWidth } from "./resize";

/** Run-state chip: icon + label always — never color alone. */
function OutcomeChip(props: {
  outcome?: string;
  running: boolean;
  stalled: boolean;
  /** Newest turn is composed but not sent — a stepped run's pause looks like this. */
  pending: boolean;
}): React.JSX.Element {
  // A trace with no result isn't necessarily live: a killed run leaves one
  // behind forever. Say "stalled" rather than claiming it's still going.
  //
  // But a stepped run parked at the presenter gate ALSO stops writing, and it
  // is the state you spend the most time in on stage — the request is built,
  // nothing has been sent. The file cannot tell that apart from a process
  // killed mid-turn, so name what is true of both rather than guessing.
  if (props.stalled && props.pending) {
    return <span className="chip chip-warning">⏸ waiting — request built, nothing sent</span>;
  }
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
      <span className="block-tokens">
        {block.region === "result"
          ? `→ ~${fmtTokens(block.tokens)} tok next request`
          : `${block.exact ? "" : "~"}${fmtTokens(block.tokens)} tok`}
      </span>
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
  // The deck is up from the first paint. Opening on a bare anatomy pane asks a
  // first-time reader to work out what they are looking at from the picture
  // alone; slide 1 names the recording it wants beside it, so the page can
  // open on a slide and its evidence together. `d` still toggles it away.
  const [showSlides, setShowSlides] = useState(true);
  const [slide, setSlide] = useState(0);
  // Moving between slides moves the viewer to that slide's recording. On by
  // default — it is the reason the binding exists — but a toggle, because
  // scrubbing back through slides mid-demo shouldn't yank the trace away.
  const [linked, setLinked] = useState(true);
  const { pins, refresh: refreshPins, unpin } = usePins();

  // Draggable widths for the side panels; the anatomy pane takes the rest.
  // Minimums are hard: with three panels up on a 1280px screen the floors sum
  // to 900px, so nothing can be dragged to nothing and lost mid-talk.
  //
  // Declared HERE, with the other hooks, and not next to the layout they
  // describe: there is an early return further down for "no trace yet", and a
  // hook after it runs on some renders and not others.
  const slidesPane = usePaneWidth("slides", 460, 280, 900);
  const runPane = usePaneWidth("run", 420, 280, 900);
  const turnsPane = usePaneWidth("turns", 240, 120, 420);

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

  /** Open a trace from the top: newest turn, nothing pinned, no stale block. */
  const openTrace = useCallback((name: string) => {
    setTraceName(name);
    setFollow(name === "live.json");
    setTurnIndex(0);
    setBlockId(null);
  }, []);

  // On a fresh clone there is no traces/live.json — it is the one trace that is
  // deliberately NOT committed, because a leftover copy makes this page read
  // "stalled". So the default of tailing it left a first-time reader staring at
  // an empty pane with 65 recordings sitting one menu away, which is a poor
  // answer to "clone it and follow along".
  //
  // Open something real instead, once, as soon as the listing arrives. In
  // order of preference:
  //
  //   1. The first recording slide 1 names, because the deck opens on slide 1
  //      and the whole point of the binding is that a slide arrives with its
  //      evidence. This is the ONLY place the startup pairing is decided — the
  //      deck-follow effect below skips slide 1 for exactly that reason, so
  //      the two cannot race and hand the pane back and forth.
  //   2. traces/pinned.json, which exists precisely to be the offline fallback.
  //   3. The newest recording, since the server returns the list newest-first.
  //
  // A run that is actually live still wins over all three. "Actually" is
  // load-bearing: live.json is gitignored but it is not cleaned up, so a
  // rehearsal from yesterday leaves one sitting there forever, and opening on
  // it means opening on "■ stalled — no result". Judge it by its mtime with
  // the same window the header uses, so a run going right now is followed and
  // a dead one steps aside for the deck.
  const pickedOpening = useRef(false);
  useEffect(() => {
    if (pickedOpening.current || files.length === 0) return;
    pickedOpening.current = true;
    const live = files.find((f) => f.name === "live.json");
    if (live && Date.now() - live.mtimeMs < STALL_MS) return;
    const fromDeck = showSlides && linked ? SLIDES[0]?.sessions[0] : undefined;
    const opening =
      files.find((f) => f.name === fromDeck) ??
      files.find((f) => f.name === "pinned.json") ??
      files[0];
    if (opening) openTrace(opening.name);
  }, [files, openTrace, showSlides, linked, STALL_MS]);

  // --- the slide the deck is on, and the recordings it is about ------------
  const slideDef = SLIDES[Math.min(slide, Math.max(0, SLIDES.length - 1))];
  const slideSessions = useMemo(() => {
    const authored = slideDef?.sessions ?? [];
    const live = (slideDef ? pins[slideDef.name] : undefined) ?? [];
    return [...authored, ...live.filter((n) => !authored.includes(n))];
  }, [slideDef, pins]);

  // Follow the deck: landing on a slide opens the first recording bound to it.
  // Applied ONCE per slide (the ref), so clicking another of the slide's
  // session chips, or pinning a new run to it, doesn't snap the view back.
  //
  // Slide 0 starts out ALREADY applied: the opening-trace effect above owns
  // what is on screen at startup. Without this the deck link would fire on the
  // first render — before the traces listing has even arrived — and either get
  // overwritten a moment later or, worse, yank the pane off a live run.
  const appliedSlide = useRef<number | null>(0);
  // The trace the link itself opened. The reverse link below must ignore it,
  // or the two effects hand the view back and forth forever.
  const linkOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!showSlides || !linked) return;
    if (appliedSlide.current === slide) return;
    appliedSlide.current = slide;
    const first = slideSessions[0];
    if (first && first !== traceName) {
      linkOpened.current = first;
      openTrace(first);
    }
  }, [slide, linked, showSlides, slideSessions, traceName, openTrace]);

  // --- and the other direction: which slides is the OPEN trace about? -------
  const slidesForOpen = useMemo(() => slidesForTrace(traceName, pins), [traceName, pins]);

  /** Move the deck to a slide without letting the forward link fight it. */
  const goToSlide = useCallback((index: number) => {
    appliedSlide.current = index;
    setSlide(index);
  }, []);

  // Pick a session and the deck follows it — but only when the answer is
  // unambiguous. One recording here backs seven slides; guessing which one you
  // meant would move the deck out from under you more often than it helped.
  useEffect(() => {
    if (!linked) return;
    if (linkOpened.current === traceName) return; // this came FROM the deck
    if (slidesForOpen.length !== 1) return;
    goToSlide(slidesForOpen[0]!.index);
  }, [traceName, linked, slidesForOpen, goToSlide]);

  const anatomy = useMemo(
    () => (session ? requestAnatomy(session, selected) : null),
    [session, selected],
  );
  // A turn that is open and has no usage yet has not been sent. Stepped runs
  // pause exactly here, so say "about to be sent" rather than "went on the
  // wire" — the whole point of the pause is reading it before it goes.
  const pending = anatomy?.turn !== undefined && !anatomy.turn.closed && !anatomy.turn.usage;
  const selectedBlock =
    anatomy?.blocks.find((b) => b.id === blockId) ??
    anatomy?.response.find((b) => b.id === blockId) ??
    null;

  const pick = (i: number): void => {
    setFollow(false);
    setTurnIndex(i);
    setBlockId(null);
  };

  /**
   * Link the deck to the traces. Turning it ON jumps to the current slide's
   * recording straight away (that is what the button says it does), which the
   * once-per-slide guard would otherwise suppress.
   */
  const toggleLink = (): void => {
    setLinked((v) => {
      if (!v) appliedSlide.current = null;
      return !v;
    });
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
          {files.length === 0
            ? "No recordings found in traces/. "
            : "Opening a recording… "}
          Run <code>npm run spike</code> in a terminal to make one — this page tails{" "}
          <code>traces/live.json</code> and draws each request as it happens.
        </p>
      </div>
    );
  }

  // The anatomy view is happy to grow and let the page scroll. The run and
  // sessions panels must NOT: their controls have to stay on screen while the
  // log or list scrolls inside them, and .viz-root's min-height:100vh would
  // otherwise let tall content push the header away.
  const panelOpen = showRun || showSessions || showSlides;
  // Slides, run controls and anatomy can all be up at once — three columns is
  // tight but it is the layout that never needs a terminal or a second window.
  const panes = 1 + (showSlides ? 1 : 0) + (showRun ? 1 : 0);

  // Widths go out as CUSTOM PROPERTIES, not as a grid-template-columns
  // string. An inline template would beat the narrow-screen media queries that
  // stack these panes into rows — inline styles outrank the stylesheet — and
  // the layout would stay in three unreadable columns on a small display.
  // Sized panes are named in order, so the CSS doesn't need to know which
  // panels are open, only how many.
  const sidePanes = [
    ...(showSlides ? [slidesPane.width] : []),
    ...(showRun ? [runPane.width] : []),
  ];
  const splitVars = {
    "--pane-a": `${sidePanes[0] ?? 0}px`,
    "--pane-b": `${sidePanes[1] ?? 0}px`,
  } as React.CSSProperties;

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
        {/* Which slides this recording is about. Always clickable; the
            auto-jump above only fires when there is exactly one. */}
        {slidesForOpen.length > 0 && (
          <span className="slide-links">
            {slidesForOpen.slice(0, 4).map((s) => (
              <button
                key={s.name}
                className={`slide-link${s.index === slide ? " slide-link-on" : ""}`}
                title={`${s.index + 1}. ${s.title}`}
                onClick={() => {
                  goToSlide(s.index);
                  setShowSlides(true);
                  setShowSessions(false);
                }}
              >
                ▤ {s.index + 1}
              </button>
            ))}
            {slidesForOpen.length > 4 && (
              <span
                className="slide-link-more"
                title={slidesForOpen
                  .slice(4)
                  .map((s) => `${s.index + 1}. ${s.title}`)
                  .join("\n")}
              >
                +{slidesForOpen.length - 4}
              </span>
            )}
          </span>
        )}
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
          pending={pending}
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
            setShowSessions(false);
            setShowRun(false);
            openTrace(name);
          }}
        />
      ) : (
        <div
          className={panes > 1 ? `split split-${panes}` : "solo"}
          {...(panes > 1 ? { style: splitVars } : {})}
        >
          {showSlides && (
            <Slides
              index={slide}
              onIndex={setSlide}
              session={session}
              sessions={slideSessions}
              pinned={(slideDef ? pins[slideDef.name] : undefined) ?? []}
              traces={described}
              currentTrace={traceName}
              onOpenSession={openTrace}
              onUnpin={(name) => {
                if (slideDef) void unpin(slideDef.name, name);
              }}
              linked={linked}
              onToggleLink={toggleLink}
              onRun={slideDef?.run ? () => setShowRun(true) : undefined}
            />
          )}
          {showSlides && (
            <Grip label="slides" onDrag={slidesPane.onDrag} onReset={slidesPane.reset} />
          )}
          {/* Run controls sit BESIDE the anatomy, not instead of it: the point
              of stepping is watching the context grow as each turn lands. */}
          {showRun && (
            <RunPanel
              // The preset follows the visible slide, so "run" on the slide
              // about rung 3 runs rung 3 — and nothing at all when the deck
              // is closed, which is the plain panel it has always been.
              preset={showSlides ? slideDef?.run : undefined}
              presetKey={showSlides ? slideDef?.name : undefined}
              presetTitle={showSlides ? slideDef?.title : undefined}
              // The server pins a run's recordings to the slide it was
              // launched from; this just picks the new file up.
              onTraces={() => void refreshPins()}
              onRunStarted={() => {
                // A new run streams into live.json — follow it as it happens.
                openTrace("live.json");
                setFollow(true);
              }}
            />
          )}
          {showRun && <Grip label="run panel" onDrag={runPane.onDrag} onReset={runPane.reset} />}
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
            {session.mode === "replay"
              ? `turn ${selected} · replay — no model requests`
              : `request for turn ${selected}${pending ? " · about to be sent" : ""}`}
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
      <div
        className="columns"
        style={{ "--pane-turns": `${turnsPane.width}px` } as React.CSSProperties}
      >
        <TurnList
          turns={turns}
          selected={selected}
          follow={follow}
          onToggleFollow={toggleFollow}
          onSelect={pick}
        />
        <Grip label="requests" onDrag={turnsPane.onDrag} onReset={turnsPane.reset} />

        <section className="stack">
          <div className="pane-title">
            {session.mode === "replay"
              ? `turn ${selected} — REPLAY: no request was sent to any model; actions re-executed from the trace`
              : pending
                ? `request for turn ${selected} — exactly what is about to go on the wire`
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
          <div className="pane-title response-title">response — what the model generated</div>
          {anatomy?.response
            .filter((b) => b.region === "response")
            .map((b) => (
              <BlockCard key={b.id} block={b} selected={b.id === blockId} onSelect={() => setBlockId(b.id)} />
            ))}
          {anatomy && anatomy.response.some((b) => b.region === "result") && (
            <div className="pane-title response-title">
              {anatomy.resultsAreNextInput
                ? // A chatbot's turn ends at the answer; what follows is the
                  // user typing again and the retriever running for them. Same
                  // slot, same "the model did not write this" point, different
                  // cause — so say the cause rather than reuse the agent wording.
                  "then the system composed the next input — not output, not billed here"
                : "then the environment answered — not output, not billed here"}
            </div>
          )}
          {anatomy?.response
            .filter((b) => b.region === "result")
            .map((b) => (
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
                  {selectedBlock.chars} chars · {selectedBlock.exact ? "" : "~"}{fmtTokens(selectedBlock.tokens)} tok
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

    </div>
  );
}
