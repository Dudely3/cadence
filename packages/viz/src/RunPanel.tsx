import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drive a run from the page: write a goal, start it, step it, watch it.
 *
 * The output pane mirrors the CLI's own stream (thought / action / observation
 * per turn) so the terminal never has to be looked at during a talk. It is a
 * mirror, not a second renderer — the server pipes the same process output the
 * terminal would have shown.
 */

interface RunState {
  running: boolean;
  id?: string;
  exitCode: number | null;
  gateReleased?: boolean;
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

export function RunPanel(props: { onRunStarted: () => void }): React.JSX.Element {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [mode, setMode] = useState<"speed" | "accuracy" | "replay">("speed");
  const [step, setStep] = useState(true);
  const [headed, setHeaded] = useState(true);
  const [state, setState] = useState<RunState>({
    running: false,
    exitCode: null,
    cursor: 0,
    lines: [],
  });
  const [error, setError] = useState<string | null>(null);
  const since = useRef(0);
  const logEnd = useRef<HTMLDivElement | null>(null);

  // Poll for output. Fast while running, lazily once it's over.
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
  }, [state.running]);

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
      goal: goal.trim() === DEFAULT_GOAL.trim() ? "" : goal, // empty = the example's built-in goal
      mode: mode === "accuracy" ? "accuracy" : "speed",
      ...(mode === "replay" ? { replay: "pinned" } : {}),
      step,
      headed,
      viewport: "940x820",
    });
    props.onRunStarted();
  }, [act, goal, mode, step, headed, props]);

  // A run waits on you in two places: the per-turn gate, and the hold that
  // keeps the finished browser on screen. Both end with a prompt and both are
  // released by the same newline, so both should light up "step".
  const lastLine = state.lines[state.lines.length - 1]?.text ?? "";
  const atTurnGate = !state.gateReleased && lastLine.startsWith("⏸");
  const atFinalHold = lastLine.startsWith("browser still open");
  const waiting = state.running && (atTurnGate || atFinalHold);

  return (
    <div className="runpanel">
      <div className="run-controls">
        <label className="run-field">
          <span>Goal</span>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            spellCheck={false}
            disabled={state.running}
            placeholder="What should the agent do on the shop page?"
          />
        </label>

        <div className="run-row">
          <label className="run-inline">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              disabled={state.running}
            >
              <option value="speed">speed (Haiku)</option>
              <option value="accuracy">accuracy (Opus + plan + critic)</option>
              <option value="replay">replay (pinned recording, free)</option>
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
            ▶ start
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
            Nothing running. Write a goal and press start — the agent drives a real browser
            window, and this pane mirrors exactly what the terminal would print.
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
