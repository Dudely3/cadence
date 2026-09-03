# Cadence

A minimal, domain-agnostic harness for agentic AI loops — the framework behind the talk
**"Speed vs. Accuracy: Execution Modes for Agentic Workflows."**

The thesis: the agent loop, the execution modes, and the observability are fixed; only the
**Environment** and its **Tools** change. Same core drives a notepad, a browser, and a music
engine. See [`DESIGN.md`](./DESIGN.md) for the full architecture.

> Open-source dependencies only (`@anthropic-ai/sdk`, `zod`). No proprietary code.

## Layout

```
packages/
  core/            agent loop, Session/Turn/Action model, tools, tracer, context builder
  model-anthropic/ the only provider-aware code (ModelClient → Claude)
  modes/           speed (Haiku) · accuracy (Opus, plan + critic) · replay
  tracer-file/     Session → disk; live.json for the viewer, <id>.json to replay
  testkit/         scripted model client + chaos wrappers (free, deterministic runs)
  viz/             the context visualizer + run control (React; tails traces/live.json)
  env-notepad/     trivial text environment — the original spike
  env-browser/     Playwright environment
  env-strudel/     live-coded music environment
examples/
  spike.ts   bare loop end-to-end          drill.ts    resilience drills
  browse.ts  browser demo                  jam.ts      music demo
  compare.ts speed vs accuracy vs replay   recover.ts  failure handling
  deps-check.ts    free dependency-tracking check   step.ts   presenter gate
  replay-check.ts  free replay-fidelity check       flags.ts  CLI flag parsing
  traces.ts  list recordings                  pin.ts    pick the stage fallback
  try.ts     write a goal and run it          ask.ts    shared terminal prompt
  env.ts     loads .env (imported first by every live example)
```

## Setup

```bash
npm install
cp .env.example .env   # then put your ANTHROPIC_API_KEY in it
```

If your key is **identity-linked** (issued to a person rather than a project), the API
also requires the workspace each request acts in, or every call 400s. Add it to `.env`:

```
ANTHROPIC_WORKSPACE_ID=<id from Console → Settings → Workspaces>
```

Shell values win over `.env`, so a one-off `ANTHROPIC_API_KEY=… npm run browse` still
overrides. Replay and scripted runs need no key at all.

Type-check the whole workspace, and run the free deterministic checks (no API key, no
cost — they use a scripted model):

```bash
npm run typecheck
```

```bash
npm run deps && npm run replay && npm run drill
```

`deps` covers plan dependency enforcement, `replay` covers replay fidelity (including
mode-owned tools like `update_plan`), `drill` runs the resilience scenarios.

## Stage runbook — the browser demo

Drive everything from the visualizer. One command, one window to touch:

```bash
npm run viz
```

Open http://localhost:5173, press **r** (or click **▶ run**), write a goal, press
**start**. The agent opens its own Chromium window; **step** advances one turn, **go**
finishes unattended, **stop** kills it.

The run panel sits **beside** the context anatomy, not instead of it: controls and the
streamed log on the left, the growing prompt on the right, the token strip underneath.
Stepping and watching the context build are the same gesture. The log mirrors exactly
what the terminal would have printed — thought, action, observation, per turn — so you
never have to look at a terminal during a talk. Press **r** again (or Escape) for the
anatomy full width.

The anatomy pane **follows** the newest turn while a run is going — the ⤓ button in the
header (or **f**) toggles that, and clicking any turn in the list pins it. Follow re-arms
on its own whenever a new run appears, however it was started, and releases once the run
ends, leaving you on the last turn.

> If the page looks empty and the chip reads **stalled — no result**, `traces/live.json`
> is left over from a run that was killed, not a broken viewer. Start a new run, or open
> a recording from ☰ sessions.
>
> Vite picks the next free port when one is busy, so a forgotten dev server means the new
> one is on 5174, 5175, … — check the port the terminal printed, and close old ones.

How this keeps the file-based design honest: the dev server *spawns the same CLI* the
terminal runs, and steps it by writing a newline to its stdin. The agent loop still
contains zero UI code, the viewer still reads context anatomy only from the trace file,
and everything below still works with the server switched off.

### Driving it from a terminal instead

The CLI is the fallback if anything about the control panel misbehaves — two windows side
by side, the agent on the left, the viewer on the right:

```bash
npm run demo
```

No flags, same in PowerShell, bash, or zsh. Variants:

| command | what you get |
| --- | --- |
| `npm run demo` | Haiku, stepped, headed, sized for half a screen |
| `npm run demo:accuracy` | same, but Opus with plan + critic — more turns to narrate |
| `npm run demo:replay` | same, from your **pinned** recording; no key, no cost |
| `npm run try` | write your own goal at a prompt and watch it run |

`--step` pauses before every turn: Enter runs one turn, `go` releases the gate and
finishes unattended. The pause lands after the previous turn is flushed to
`traces/live.json`, so the browser and the viewer show the same moment while you talk.
When the run ends the browser stays open on the final page until you press Enter, so the
finished cart is still on screen for the wrap-up.

In accuracy mode the planner runs during setup — so the plan is already in the cached
prefix at your first pause — while the critic runs inside the turn, firing after you
press Enter.

### Trying a new goal

```bash
npm run try
```

Asks for a goal in plain words, then runs it against the shop page stepped and headed,
exactly like `npm run demo`. Nothing to edit, no flags. It's the "the loop is
domain-agnostic" claim made interactive: same loop, same tools, different words. The run
records a trace like any other, so it lands in `npm run traces`, the Sessions view, and
can be pinned or replayed.

To skip the prompt, pass the goal directly:

```bash
npx tsx examples/browse.ts --step --headed --goal "Add the two cheapest Camping items to the cart."
```

### Choosing the replay

A finished live run writes `traces/<sessionId>.json`, and any of them can be replayed.
Session ids say nothing on their own, so there are two ways to see what you have.

In the visualizer, press **s** (or click **☰ sessions**) for the session overview: every
trace with its goal, mode, outcome, what it did, and what it cost. Click one to open it.

In a terminal:

```bash
npm run traces
```

Then pin the one that should be your stage fallback:

```bash
npm run pin
```

`pin` shows a numbered list and copies your choice to `traces/pinned.json`, which is what
`npm run demo:replay` uses — so the fallback is a run you picked deliberately, not
"whatever happened to run last". It's a copy, so clearing out old recordings can't break
it. Enter, `q`, or Ctrl+C cancels without changing anything. With nothing pinned,
`demo:replay` falls back to the newest completed run and says so.

To replay one specific recording without pinning it, pass the id (no path or extension
needed):

```bash
npx tsx examples/browse.ts --step --headed --replay sess_mtes6cyx_1
```

**Record a fallback before you present.** If the venue wifi dies, the pinned replay is
the same demo, offline and free.

### Replaying an accuracy recording

Accuracy mode registers its own `update_plan` tool, and a replay isn't running accuracy
mode — there's no plan state to update. Replay therefore **skips** calls to any tool the
recording has but the current run doesn't, including a recorded turn made up entirely of
them (it prints a line saying so). Real environment tools still execute for real against
the live browser. If you'd rather keep those calls and have replay mirror the recording
turn for turn, pass `unknownTools: "stub"` to `replayMode()`.

### Custom flags

Invoke `tsx` directly:

```bash
npx tsx examples/browse.ts --step --headed --viewport 1200x900 --mode accuracy
```

Flags: `--step`, `--headed`, `--viewport WxH`, `--mode accuracy`, `--goal "<text>"`,
`--goal-id <id>`, `--replay <path|latest|pinned|id>`
(each has a `--no-` form). Bash users can still use the `STEP=1 HEADED=1 …` env vars; an
explicit flag beats an env var.

> **Don't use `npm run demo -- --flag` on PowerShell.** PowerShell strips the `--`, npm
> then swallows the flags as its own config, and the script runs with defaults — silently.
> That's why the ready-made scripts above exist.
