import { useCallback, useEffect, useRef, useState } from "react";
import type { SlideRun } from "./slideDeck";

/**
 * Drive a run from the page: write a goal, start it, step it, watch it.
 *
 * The output pane mirrors the CLI's own stream (thought / action / observation
 * per turn) so the terminal never has to be looked at during a talk. It is a
 * mirror, not a second renderer — the server pipes the same process output the
 * terminal would have shown.
 *
 * A slide can hand this panel a `preset`, which is the whole point of the
 * slide/session binding: reaching the slide about rung 1 loads rung 1's
 * command, so running it live is one button rather than four fields to fill in
 * while a room watches.
 */

interface RunState {
  running: boolean;
  id?: string;
  exitCode: number | null;
  gateReleased?: boolean;
  /** Recordings this run wrote — reported once, after it exits. */
  newTraces?: string[];
  /** The slide the run was started from, as the server recorded it. */
  slide?: string;
  cursor: number;
  lines: Array<{ n: number; text: string }>;
}

const DEFAULT_GOAL =
  "Add the cheapest item in the Camping category to the cart (exactly one item), then call complete.";

async function post(route: string, body?: unknown): Promise<{ error?: string }> {
  const res = await fetch(`/control/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (await res.json()) as { error?: string };
}

/** Colour the mirrored stream the way the terminal reads it. */
function lineClass(text: string): string {
  if (text.startsWith("●")) return "run-line run-line-turn";
  if (text.startsWith("  →")) return "run-line run-line-action";
  if (text.startsWith("  ←")) return "run-line run-line-obs";
  if (text.startsWith("  ✗") || text.startsWith("✗")) return "run-line run-line-error";
  if (text.startsWith("⏸")) return "run-line run-line-gate";
  if (text.startsWith("✓")) return "run-line run-line-done";
  if (text.startsWith("$")) return "run-line run-line-cmd";
  return "run-line";
}

export function RunPanel(props: {
  onRunStarted: () => void;
  /** Run configuration from the current slide, if it has one. */
  preset?: SlideRun | undefined;
  /** Slide file name — identifies the preset, and is what a run gets pinned to. */
  presetKey?: string | undefined;
  /** Slide title, for the "loaded from" line. */
  presetTitle?: string | undefined;
  /**
   * Recordings a finished run wrote, with the slide it was started from —
   * taken from the server rather than from the current UI state, so a run that
   * finishes after you have moved on still lands on the slide that launched it.
   */
  onTraces?: (traces: string[], slide: string | undefined) => void;
}): React.JSX.Element {
  const { preset, presetKey } = props;
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [mode, setMode] = useState<"speed" | "accuracy" | "replay">("speed");
  const [step, setStep] = useState(true);
  const [headed, setHeaded] = useState(true);
  // The one value a slide invites you to change before pressing start.
  const [paramValue, setParamValue] = useState("");
  const [state, setState] = useState<RunState>({
    running: false,
    exitCode: null,
    cursor: 0,
    lines: [],
  });
  const [error, setError] = useState<string | null>(null);
  const since = useRef(0);
  const logEnd = useRef<HTMLDivElement | null>(null);

  // Load the slide's preset into the editable fields. Keyed on the slide, so
  // moving between slides re-arms it but typing in the goal box is never
  // overwritten while you're on one slide.
  useEffect(() => {
    if (!preset) return;
    if (preset.goal !== undefined) setGoal(preset.goal);
    if (preset.mode !== undefined) setMode(preset.mode);
    else if (preset.replay !== undefined) setMode("replay");
    if (preset.step !== undefined) setStep(preset.step);
    if (preset.headed !== undefined) setHeaded(preset.headed);
    setParamValue(preset.paramValue ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  // A script with its own flags (the ladder) owns its goal and its page; the
  // goal box would be a lie, so it's hidden and the command is shown instead.
  const ownsGoal = preset?.script !== undefined && preset.script !== "examples/browse.ts";

  // Poll for output. Fast while running, lazily once it's over.
  const reported = useRef<string | undefined>(undefined);
  const onTraces = props.onTraces;
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/control/state?since=${since.current}`);
        if (!res.ok) return;
        const data = (await res.json()) as RunState;
        if (!alive) return;
        since.current = data.cursor;
        setState((prev) => ({
          ...data,
          lines: data.lines.length ? [...prev.lines, ...data.lines].slice(-500) : prev.lines,
        }));
        // Report the recordings once the run is over and only once: the poll
        // keeps returning them, and pinning the same trace twice would be a
        // duplicate row on a slide.
        if (!data.running && data.newTraces?.length && reported.current !== data.id) {
          reported.current = data.id;
          onTraces?.(data.newTraces, data.slide);
        }
      } catch {
        /* server restarting — keep what we have */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), state.running ? 400 : 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state.running, onTraces]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [state.lines.length]);

  const act = useCallback(async (route: string, body?: unknown) => {
    const out = await post(route, body);
    setError(out.error ?? null);
  }, []);

  const start = useCallback(async () => {
    since.current = 0;
    setState({ running: true, exitCode: null, cursor: 0, lines: [] });
    await act("start", {
      // An unchanged default means "use the example's own goal" — the built-in
      // one, so the recording's goalId stays comparable with earlier runs.
      goal: ownsGoal || goal.trim() === DEFAULT_GOAL.trim() ? "" : goal,
      mode: mode === "accuracy" ? "accuracy" : "speed",
      ...(mode === "replay" ? { replay: preset?.replay ?? "pinned" } : {}),
      step,
      headed,
      // A script with its own goal has its own window too — only size it if
      // the slide asked for a size.
      viewport: preset?.viewport ?? (ownsGoal ? "" : "940x820"),
      ...(preset?.script ? { script: preset.script } : {}),
      ...(preset?.args ? { args: preset.args } : {}),
      ...(preset?.url ? { url: preset.url } : {}),
      ...(preset?.goalId ? { goalId: preset.goalId } : {}),
      // Sent as its own field, not inside `args`: this one is allowed to
      // contain spaces, and the server pushes it as a separate argv entry.
      ...(preset?.paramFlag && paramValue.trim()
        ? { paramFlag: preset.paramFlag, paramValue: paramValue.trim() }
        : {}),
      ...(presetKey ? { slide: presetKey } : {}),
    });
    props.onRunStarted();
  }, [act, goal, mode, step, headed, paramValue, ownsGoal, preset, presetKey, props]);

  // A run waits on you in two places: the per-turn gate, and the hold that
  // keeps the finished browser on screen. Both end with a prompt and both are
  // released by the same newline, so both should light up "step".
  const lastLine = state.lines[state.lines.length - 1]?.text ?? "";
  const atTurnGate = !state.gateReleased && lastLine.startsWith("⏸");
  const atFinalHold = lastLine.startsWith("browser still open");
  const waiting = state.running && (atTurnGate || atFinalHold);

  const command = [
    preset?.script ?? "examples/browse.ts",
    step ? "--step" : "",
    headed ? "--headed" : "",
    preset?.paramFlag && paramValue.trim() ? `${preset.paramFlag} "${paramValue.trim()}"` : "",
    ...(preset?.args ?? []),
    preset?.url ? `--url ${preset.url}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="runpanel">
      <div className="run-controls">
        {preset && (
          <p className="run-preset">
            <span className="chip chip-mini chip-good">▤ slide preset</span>{" "}
            {preset.label ?? props.presetTitle ?? presetKey}
            {preset.note && <span className="run-preset-note"> — {preset.note}</span>}
          </p>
        )}

        {/* The editable value, when the slide offers one. Above the command
            line on purpose: the command updates as you type, which is the
            whole point being demonstrated. */}
        {preset?.paramFlag && (
          <label className="run-field">
            <span>{preset.paramLabel ?? preset.paramFlag.replace(/^--/, "")}</span>
            <input
              type="text"
              value={paramValue}
              onChange={(e) => setParamValue(e.target.value)}
              spellCheck={false}
              disabled={state.running}
              placeholder={preset.paramValue ?? ""}
            />
          </label>
        )}

        {ownsGoal ? (
          <p className="run-fixed" title="this script sets its own goal and page">
            <code>tsx {command}</code>
          </p>
        ) : (
          <label className="run-field">
            <span>Goal</span>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              spellCheck={false}
              disabled={state.running}
              placeholder="What should the agent do on the page?"
            />
          </label>
        )}

        <div className="run-row">
          <label className="run-inline">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              disabled={state.running || ownsGoal}
            >
              <option value="speed">speed (Haiku)</option>
              <option value="accuracy">accuracy (Opus + plan + critic)</option>
              <option value="replay">replay (recording, free)</option>
            </select>
          </label>
          <label className="run-inline">
            <input
              type="checkbox"
              checked={step}
              onChange={(e) => setStep(e.target.checked)}
              disabled={state.running}
            />
            <span>pause each turn</span>
          </label>
          <label className="run-inline">
            <input
              type="checkbox"
              checked={headed}
              onChange={(e) => setHeaded(e.target.checked)}
              disabled={state.running}
            />
            <span>show browser</span>
          </label>
        </div>

        <div className="run-row">
          <button className="run-btn run-btn-primary" onClick={() => void start()} disabled={state.running}>
            ▶ {preset?.label ? preset.label : "start"}
          </button>
          <button
            className={`run-btn${waiting ? " run-btn-ready" : ""}`}
            onClick={() => void act("step")}
            disabled={!state.running}
            title="advance one turn"
          >
            ⏭ step
          </button>
          <button className="run-btn" onClick={() => void act("go")} disabled={!state.running}>
            ⏩ go
          </button>
          <button className="run-btn" onClick={() => void act("stop")} disabled={!state.running}>
            ■ stop
          </button>
          <span className="run-status">
            {state.running
              ? atFinalHold
                ? "done — press step to close the browser"
                : waiting
                  ? "waiting — press step"
                  : "running…"
              : state.exitCode === null
                ? "idle"
                : `finished (exit ${state.exitCode})`}
          </span>
        </div>
        {error && <p className="run-error">{error}</p>}
      </div>

      <div className="run-log">
        {state.lines.length === 0 && (
          <p className="hint">
            Nothing running. {preset ? "This slide's run is loaded — press start." : "Write a goal and press start."}{" "}
            The agent drives a real browser window, and this pane mirrors exactly what the
            terminal would print.
          </p>
        )}
        {state.lines.map((l) => (
          <div key={l.n} className={lineClass(l.text)}>
            {l.text}
          </div>
        ))}
        <div ref={logEnd} />
      </div>
    </div>
  );
}
