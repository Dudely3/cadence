# Cadence

A minimal, domain-agnostic harness for agentic AI loops — the framework behind the talk
**"Speed vs. Accuracy: Execution Modes for Agentic Workflows."**

The thesis: the agent loop, the execution modes, and the observability are fixed; only the
**Environment** and its **Tools** change. Same core drives a notepad, a browser, and a music
engine.

> Open-source dependencies only (`@anthropic-ai/sdk`, `zod`). No proprietary code.

**Where to go next.** [`DESIGN.md`](./DESIGN.md) is the architecture, and its section
numbers are cited from the source comments. [`CLAUDE.md`](./CLAUDE.md) is the working
contract — the invariants and the checks — and it is what to hand a coding agent.
[`EXERCISES.md`](./EXERCISES.md) is how to learn the harness by breaking it.

**The 60-second version**, free and needing no API key:

```bash
npm install && npm run check
```

## Layout

```
packages/
  core/            agent loop, Session/Turn/Action model, tools, tracer, context builder
  model-anthropic/ the only provider-aware code (ModelClient → Claude)
  modes/           speed (Haiku) · accuracy (Opus, plan + critic) · replay · naive (rung 1)
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
  rerun.ts         one recording, re-pointed at different values (free replays)
  floor-check.ts   why a run isn't caching (prefix vs the model's floor)
  deps-check.ts    free dependency-tracking check   step.ts   presenter gate
  replay-check.ts  free replay-fidelity check       flags.ts  CLI flag parsing
  traces.ts  list recordings                  pin.ts    pick the stage fallback
  try.ts     write a goal and run it          ask.ts    shared terminal prompt
  cache-lab.ts   measures append-vs-merge caching
  format-lab.ts  measures cost of context format (and whether the model cares)
  ladder.ts      the 4-rung context ladder (naive → explore), with a cart check
  slides-check.ts  free check that every slide binding still resolves
  env.ts     loads .env (imported first by every live example)
  site/bigshop.html  255-product catalogue — big, local, deterministic
slides/
  *.md       the talk, one file per slide; frontmatter binds recordings + a run
  pins.json  what live runs bound to a slide (written by the viewer)
traces/      recorded runs — replay artifacts, and the offline stage fallback
```

## Setup

Needs **Node 20.12 or newer** — `examples/env.ts` uses `process.loadEnvFile`.

```bash
npm install
```

That is everything the free checks need. The browser demos additionally need a
Chromium build, which npm does not install for you:

```bash
npm run setup
```

For live model runs, add a key:

```bash
cp .env.example .env   # then put your ANTHROPIC_API_KEY in it
```

If your key is **identity-linked** (issued to a person rather than a project), the API
also requires the workspace each request acts in, or every call 400s. Add it to `.env`:

```
ANTHROPIC_WORKSPACE_ID=<id from Console → Settings → Workspaces>
```

Shell values win over `.env`, so a one-off `ANTHROPIC_API_KEY=… npm run browse` still
overrides. Replay and scripted runs need no key at all.

## The free checks

One command type-checks the workspace and runs every deterministic check. No API key,
no network, no cost — they drive a scripted model:

```bash
npm run check
```

That is `typecheck`, `deps`, `replay`, `drill` and `slides`, and each runs on its own too.
CI runs exactly this on Node 20 and 22.

`deps` covers plan dependency enforcement, `replay` covers replay fidelity (including
mode-owned tools like `update_plan`), `drill` runs the resilience scenarios, and
`slides` renders every slide with the viewer's own markdown parser, checks that every
recording a slide points at is still on disk, and checks that every run a slide can launch
is one the control server will actually spawn. It also runs the parser against fenced code,
an unclosed fence, tables, bullets and block quotes whether or not a slide currently uses
them — the fenced-code branch once threw `RangeError: Invalid array length` and shipped
unnoticed for days because no slide had a code fence in it.

Two more make real API calls, because they exist to *measure* claims rather than assert
them — each prints a table you can put on a slide:

```bash
npm run cachelab    # append vs merge: what merging history into one block costs
npm run formatlab   # raw HTML vs stripped vs text vs element list: tokens + correctness
npm run ladder      # the context ladder: 4 context strategies, local 255-product page
npm run ladder:web  # the same ladder on prairiedevcon.com — a real 76K-token page
```

And one that answers a question the others raise — *why isn't this run caching?*

```bash
npm run floor
```

It measures each recording's **cached prefix** (everything up to and including the block
carrying `cache_control`) against the model's minimum cacheable prefix. Almost every
"caching is broken" is this: the prompt is plenty big, but the part *eligible* to cache is
under the floor, because good context construction deliberately keeps the bulk outside it.
Token counts come from `count_tokens`, not `chars/4` — the floor is a hard threshold and an
estimate on the wrong side of it answers the question backwards. Costs a token count per
trace, no completions.

`ladder` is the centrepiece measurement: one goal, one loop, one page, climbed four
times — naive → volatile tail → cleaned page → let-it-explore. It writes a trace per
rung so you can open all four in ☰ sessions and scrub the same task under each strategy.
`--rung 3` climbs one rung on its own, and `--step --headed` turns that rung into a
demo instead of a measurement — which is what the per-rung slides launch.
Live model runs vary by 10-20% between executions, so record one good run and pin it
rather than running it cold on stage.

`ladder:web` is the sharper version. On a real page the naive rungs don't cost more —
they return the **wrong answer**: rung 1 gives up ("unable to locate a session…") with the
answer sitting past its 200,000-character cut, and rung 2 confidently reports a different
session by a different speaker. Both report `completed`. Rungs 3 and 4 get it right for
two cents and one. It needs the network, so keep the local `ladder` as the rehearsable one.

One result on the local page is worth knowing before you read the table, and one trap
with it. Rung 1's prompt is append-only, so almost none of it is billed fresh — nine
tokens across a three-turn run, against rung 2's 60,936. Rung 2 does the right thing,
state past the cache line, and by definition that moves the expensive part outside the
cached prefix where it is billed at full price every turn. The argument for rung 2 is
that the peak prompt stops growing, not that the invoice shrinks.

The trap is comparing the two on cost at all. Rung 1 freezes everything it ever saw, so
its bill is dominated by cache **writes** — 97,021 tokens at 1.25x in that same run —
and both of those totals move with the turn count. One recording has rung 1 at half
rung 2's cost; the next has it at double, on the same code and the same page, because
the model took one more turn. Rungs 3 and 4 beat both in every run recorded so far;
that ordering is structural and the 1-vs-2 ordering is not.

Every rung caches now, which took a deliberate change: the shared system prompt carries a
real operating guide (`packages/core/src/operating-guide.ts`) and the browser environment
offers its full tool surface, together taking the frozen prefix from ~900 tokens to ~4,500
— over Haiku 4.5's 4,096-token floor. **Making the constant part bigger to make the run
cheaper** is the counter-intuitive consequence of a hard threshold, and it only works
because those bytes never change. Edit either and re-run `npm run floor`.

## Stage runbook — the browser demo

Drive everything from the visualizer. One command, one window to touch:

```bash
npm run viz
```

Open http://localhost:5173, press **r** (or click **▶ run**), write a goal, press
**start**. The agent opens its own Chromium window; **step** advances one turn, **go**
finishes unattended, **stop** kills it.

The run panel sits **beside** the context anatomy, not instead of it: controls and the
streamed log on the left, the growing prompt on the right.
Stepping and watching the context build are the same gesture. The log mirrors exactly
what the terminal would have printed — thought, action, observation, per turn — so you
never have to look at a terminal during a talk. Press **r** again (or Escape) for the
anatomy full width.

Blocks are labelled by **the request they belong to**, not by where they are stored. For
an agent those are the same thing. For the authored chatbot trace they are not — its
user-side blocks are the next request's input — so `resultsAreNextInput` shifts the label
too, and `user message 2` appears as `turn 2 · user message 2` in the request it actually
went out in.

The header also shows **which slides the open recording is about** (`▤ 5`), the reverse of
a slide's session strip. Click one to jump the deck there. Picking a session moves the deck
on its own only when the answer is unambiguous — one agent run here backs seven slides, and
guessing would move the deck out from under you more often than it helped.

The **requests** column is both the turn picker and the token chart. Each row carries the
turn's index, its first tool, its total, and a stacked bar (cache read / write / fresh /
output) on a scale shared across the run — so a prompt that doubles every turn reads as a
staircase running *down* the column, and the peak is named in the pane title. These used to
be two controls, a list and a footer chart, doing the same job in two places; measured at
1600x900 with a two-turn run the list was 240x650 holding 52px of rows and the footer was
1564x150 holding 120px of bars, both about 90% empty in opposite directions. Merging them
moved 150px of height into the block stack, which in the three-pane split had only 396px.

**Every seam is draggable**, and the widths are remembered per browser — set the layout
once for the projector and it stays set. Drag the thin line between panes, or focus it and
use ←/→ (Shift for bigger steps); double-click or press Home to reset that one. Hard floors
stop anything vanishing: side panels can't go below 280px, the anatomy pane never below
320px however far you drag, and the requests column stays between 120 and 420. Under
1100px wide the panes stack into rows and the seams disappear, because a vertical seam
means nothing when the panes are stacked.

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

### The deck, and what each slide is bound to

Press **d** (or click **▤ slides**) for the talk itself — `slides/*.md`, in filename
order, rendered beside the anatomy. `{{placeholder}}` values resolve against the trace
that is currently open, so a claim about caching is illustrated with the numbers from
the run on screen.

A slide can also name **the recordings it is about** and **the run it can launch**, in
frontmatter at the top of the file:

```
---
sessions: sess_mtokkqsv_1, sess_mtokl26s_2
run.label: run rung 1 live
run.script: examples/ladder.ts
run.args: --scenario shop --rung 1
run.step: true
run.headed: true
run.note: one live rung, Haiku, about 8 cents
---
```

Then:

- **Moving to a slide opens its first recording.** The ⇄ button in the slide bar toggles
  that; clicking any chip in the session strip opens that one instead, and a chip you
  opened by hand is never pulled away by a pin arriving later.
- **▶ on the slide loads its run.** The goal, mode, page, stepping and window size are
  already set — start is the only thing left to press. Slides whose run is a script with
  its own flags (the ladder rungs) show the exact command instead of a goal box, because
  that script owns its goal.
- **What a run records is pinned back to that slide.** The control server does the
  binding when the child exits, so it survives a reload, a closed tab, and a run that
  finishes after you have moved on. Pins land in `slides/pins.json`, which is committed
  like `traces/` is — a rehearsal's recordings are stage insurance. The two stores differ
  by who writes them: you edit frontmatter, the server writes pins. That is why only a
  pin gets a ✕.

`npm run slides` checks all of that from a terminal — every bound recording exists, every
run would spawn the script it names — which is the check to run *before* you present, not
after a chip comes up empty on stage.

Available keys: `run.label`, `run.script`, `run.goal`, `run.goalId`, `run.mode`,
`run.replay`, `run.url`, `run.args`, `run.step`, `run.headed`, `run.viewport`, `run.note`.
`run.args` is whitespace-split, so anything containing a space (a goal, a URL with a
query) needs its own key.

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
finishes unattended. When the run ends the browser stays open on the final page until you
press Enter, so the finished cart is still on screen for the wrap-up.

**At the pause you are looking at the request that is about to be sent, in full.** The
loop asks the mode to compose the turn's volatile content — the state block, plan
progress, critic feedback — and writes the trace *before* the gate, so the pane header
reads "exactly what is about to go on the wire" and every block is there to click. This
is the difference between narrating a prompt and reading one.

Because that composition happens ahead of the gate, accuracy's critic call also lands
before the pause: its verdict is already in the tail when you stop to talk about it. The
planner still runs during setup, so the plan is in the cached prefix from the first
request.

> While you are parked at the gate the trace legitimately stops changing, and the chip
> reads **⏸ waiting — request built, nothing sent**. The file cannot tell a presenter
> pause from a process killed mid-turn, so it says what is true of both. A trace with no
> turns at all still reads **stalled**.

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

Two of those recordings are **hand-written**, not captured — `example-rag-chatbot.json` and
`example-solo-legacy.json` exist so another architecture can be put beside a real run. A
Turn is shaped for an agent loop (the assistant acts, then results come back), and a
chatbot's turn boundary falls elsewhere (a user message plus its retrieval goes in, an
answer comes out). Rather than distort the drawing, those traces set
`session.presentation` — `hideGoal` for "a chat's prompt is system → chat and nothing
else", and `resultsAreNextInput` for "the user-side blocks on this turn are the NEXT
request's input". Without the second flag the viewer drew the next user message under
"response — what came back", showing an input as an output. Live runs never set either.

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

### Re-pointing a recording at different values

A trace is a program, not a video — if the recording knows what it was *about*:

```bash
npm run rerun
```

One live run adds "Titanium Tent Stakes" to the cart with `params: { item: ... }`
recorded on the session. Then the same recording is replayed for **Camp Stove**,
**Packraft** and **Dry Bag 20L** — three different carts, zero model calls, zero cost.
Pass `--replay latest` (or an id) to skip the paid run entirely and make the whole demo
free; `--items "A,B"` picks your own.

It works because of what is captured beside each click:

```
recorded   click { elementId: 2 }
           argSources.elementId = dom "button|Add Titanium Tent Stakes to cart"
replayed   dom "button|Add Camp Stove to cart"  →  element [3] today
```

Replay substitutes every recorded param value in the arguments it passes **and in the DOM
selectors it re-resolves**, then asks the environment to find that element now. A
recording that stored only `elementId: 2` would be re-runnable exactly once, on a page
that had not moved.

**On stage, type the product into the page.** Slide 24 declares an editable value:

```
run.paramFlag: --items
run.paramLabel: Product
run.paramValue: Camp Stove
```

The run panel shows a **Product** field, and the command line under it rewrites itself as
you type — `tsx examples/rerun.ts --headed --items "Down Sleeping Bag" --replay latest`.
Press start and the same recording clicks a different button. The value goes to the server
as its own field rather than inside `run.args`, because it is allowed to contain spaces
(`args` tokens are not); the server passes it as a separate argv entry, refuses anything
with control characters, and the child is spawned without a shell.

Three deliberate limits, all of them visible in the output:

- **Values under three characters are refused.** Substituting `"a"` everywhere is not a
  feature.
- **The completion summary is never rewritten.** No model runs during a replay, so that
  sentence is the recorded model's; substituting the name into it would produce a fluent
  sentence with the recorded run's *price* still inside. Judge a re-pointed replay by the
  world it leaves behind, which is what `rerun` checks.
- **A selector that matches nothing fails the call.** It does not fall back to the
  recorded element id — that id is a positional handle from another run, and reusing it
  means clicking whatever sits there now and reporting success. `npm run rerun` ends by
  re-pointing at an item that doesn't exist and asserting the cart stays empty.

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
