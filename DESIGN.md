# Cadence — Architecture

A minimal, domain-agnostic harness for agentic AI loops. Built to back the talk
**"Speed vs. Accuracy: Execution Modes for Agentic Workflows."**

This document describes the harness **as it is**, and its section numbers are
referenced from the source comments. For how to run it, see
[`README.md`](./README.md); for the rules to work within, see
[`CLAUDE.md`](./CLAUDE.md).

> **Dependency policy:** open-source / publicly available packages only
> (`@anthropic-ai/sdk`, `zod`, `zod-to-json-schema`, Playwright, React, Vite).
> No code is shared with any proprietary system. The `Session/Turn/Action` model
> below is a clean-room implementation of a general agent pattern.

---

## 1. Thesis

A good agent harness is **domain-agnostic**: the loop, the execution modes, and
the observability are fixed; only the **Environment** and its **Tools** change.

Three environments drive the same core, and the loop cannot tell them apart:

1. A **notepad** (`env-notepad`) — trivial, in-memory, no dependencies.
2. A **browser** (`env-browser`) — Playwright. Objective success: is the right
   thing in the cart?
3. A **Strudel** live-coding music engine (`env-strudel`) — subjective success:
   the critic checks structural rules, because nothing in the loop can hear.

The same goal runs under different **execution modes**, and the tradeoff is made
measurable — wall-clock, LLM calls, tokens, cost, and whether the goal was
*actually* met. That comparison (`npm run compare`) and the context ladder
(`npm run ladder`) are the centrepieces.

---

## 2. Design principles

- **The loop never changes.** Modes and environments are injected, never
  branched into. `agent.ts` contains no `if (mode === …)` anywhere.
- **The loop never builds a prompt.** Composing the request is the mode's job.
  This is not style: replay produces decisions without a prompt existing at all,
  so a loop that pre-built a request would make replay a special case.
- **There is exactly one message builder.** `buildMessages()` renders a Session
  into a request, and the viewer calls that same function to draw it. A second
  renderer drifts, and the first symptom is a block that was sent but not drawn.
- **The trace is the context.** A `Session` is a complete account of what the
  model saw: system prompt, tool schemas, initial observation, every frozen
  turn, and the volatile content of each. What goes on the wire and what lands
  in the file are the same bytes by construction.
- **Logging is the foundation, not a feature.** The trace you collect to debug
  *is* the artifact replay consumes.
- **Tools are typed.** Every tool carries a zod schema; args are validated
  before execution, and a rejection goes back to the model as an observation.
- **Failures are observations.** An unknown tool, invalid args, or a throwing
  tool all become an error `tool_result`. Only transport failures (retry,
  timeout) are handled outside the model's view, as `ModelClient` decorators.
- **Everything is streamable.** Each loop event is emitted so a renderer can
  show `thought → tool call → observation` live.

---

## 3. Core abstractions

TypeScript, in `packages/core`. Interfaces first; implementations are swappable.

### 3.1 Goal & context

```ts
interface Goal {
  id: string;
  description: string;                      // natural-language objective
  successCriteria?: string;                 // folded into the system prompt
  completionStatuses?: CompletionStatus[];  // default: success / failure
}

interface RunContext {
  goal: Goal;
  step: number;
  scratch: Record<string, unknown>;         // mode-private state
}
```

There is no `history` on `RunContext`. History lives in exactly one place —
`session.turns` — and modes read it from there.

### 3.2 Observation, Action, ActionResult

```ts
interface Observation {
  summary: string;   // model-facing description of current state
  raw?: unknown;     // structured detail, never sent to the model
}

interface ActionResult {
  ok: boolean;
  observation: Observation;
  error?: string;
  done?: boolean;                           // the run is over
  completionStatus?: string;                // which status it ended with
  argSources?: Record<string, ArgSource>;   // provenance, for replay (§6)
}
```

**Completion is a status, not a boolean.** The core `complete` tool (§3.3) takes
a value from an enumerated set, and that status is data a workflow layer could
branch on. `RunResult.success` is true only when the run `completed` *and* the
declared status maps to success.

### 3.3 Tool & registry

```ts
interface Tool<A> {
  name: string;
  description: string;
  schema: ZodType<A>;                        // validated before execute runs
  execute(env: Environment, args: A, ctx: RunContext): Promise<ActionResult>;
}

class ToolRegistry {
  register(tool: Tool): void;     // modes add their own in prepare()
  list(): Tool[];
  get(name: string): Tool | undefined;
  toModelSchema(): ToolDef[];     // zod → JSON Schema, via zod-to-json-schema
}
```

Environments do **not** define a terminator. `completionTool(goal)` comes from
core and is registered alongside the environment's tools:

```ts
new ToolRegistry([...env.availableTools(), completionTool(goal)])
```

### 3.4 Environment — *the key abstraction*

```ts
interface Environment {
  name: string;
  observe(): Promise<Observation>;
  availableTools(): Tool[];
  systemHint?(): string;                            // appended to the system prompt
  resolveArg?(source: ArgSource): Promise<unknown>; // replay re-resolution (§6)
  reset?(): Promise<void>;
  dispose?(): Promise<void>;
}
```

`NotepadEnv`, `BrowserEnv`, and `StrudelEnv` all implement this. **Swapping them
is the demo that proves the thesis.**

### 3.5 Model client

```ts
interface ModelRequest {
  system?: string;
  messages: Message[];        // neutral content-block union, not provider types
  tools: ToolDef[];
  model: string;
  maxTokens: number;
  thinking?: "adaptive";
  effort?: Effort;            // omit on Haiku — unsupported, would 400
  toolChoice?: ToolChoice;
}

interface ModelClient {
  decide(req: ModelRequest): Promise<ModelResult>;
}
```

`@cadence/model-anthropic` is the only provider-aware code in the harness; it
translates the neutral shapes to and from the Messages API. `@cadence/testkit`
supplies a scripted client so the loop runs free and deterministically.

Transport concerns are **decorators**, not loop code:
`resilient(client)` is `withRetry(withTimeout(client))`, retrying 408/409/429/5xx
and timeouts with exponential backoff and jitter.

### 3.6 Execution mode — *the speed/accuracy knob*

A **policy object**, not a config bag.

```ts
interface ExecutionMode {
  name: string;
  maxSteps: number;

  /** One-time setup before the first turn. May register mode-owned tools and
   *  make aux model calls; runs before the trace freezes its static parts. */
  prepare?(input: ModeDeps & { observation; session }): Promise<void>;

  /** Compose the system prompt. Called once, recorded onto the Session. */
  system(input: { goal; env; ctx }): string;

  /** Compose this turn's volatile content WITHOUT calling the model. Must be
   *  idempotent — decide() asks for the same thing immediately afterwards. */
  composeTurn?(input: DecideInput): Promise<PendingRequest>;

  /** Produce this turn's decision — the model call, or the trace read. */
  decide(input: DecideInput): Promise<ModelResult>;
}
```

Model tier, token budget, thinking and effort are private to a mode's
`decide()` — invisible to the loop and absent from this interface.

**There are deliberately no `verify` or `retry` hooks.** A failed tool call is
an observation the model reads. How many consecutive failures a mode tolerates
before steering toward completion-with-failure is private policy in
`ctx.scratch`. Accuracy's critic lives inside its `composeTurn()`, not as a loop
hook — which is why adding a critic did not change `agent.ts`.

**Why `composeTurn` is separate from `decide`.** A stepped run pauses *before*
the model call, and at that pause the whole request should be on screen. The
loop calls `composeTurn()`, records what it returns onto the open turn, and
flushes the trace — then pauses. Without that split you find out what you were
about to send by sending it.

### 3.7 Session / Turn / Action — *the unit of both replay and caching*

```ts
interface Action {
  id: string;                                 // stable: replay matches by identity
  tool: string;
  args: Record<string, unknown>;
  argSources?: Record<string, ArgSource>;     // which args re-resolve (§6)
  result?: ActionResult;
}

interface Turn {
  index: number;
  thought?: string;
  actions: Action[];
  assistantBlocks: ContentBlock[];   // the model's response, neutral form
  toolResults: ContentBlock[];       // what executing this turn's actions produced
  closed: boolean;                   // FROZEN — its bytes never change again
  cacheable: boolean;                // set on close
  tail?: string;                     // volatile content sent AFTER the breakpoint
  stateAt?: string;                  // full state frozen into history (freezeState only)
  critic?: { ok: boolean; feedback?: string };
  usage?: Usage;
  timing: { startedMs: number; durationMs: number };
  compacted?: { summary: string };   // declared; not yet read by buildMessages
}

interface Session {
  id: string;
  goal: Goal;
  mode: string;
  turns: Turn[];
  system?: string;                    // rendered system prompt
  tools?: ToolDef[];                  // the schemas sent with every request
  initialObservation?: Observation;
  contextShape?: ContextShape;        // request layout, as DATA (§6.1)
  presentation?: SessionPresentation; // drawing hints for AUTHORED traces only
  params?: Record<string, string>;    // what this run was ABOUT, by name (§6)
  auxUsage?: Usage[];                 // planner / critic calls, outside the loop
  startedMs: number;
}
```

**Why Turn is the right grain:**

- *Replay* (§6) walks `session.turns` in order, re-resolving `argSources`
  against the live environment. Turn granularity also enables **warm-start**:
  replay turns `0..N`, then hand off to a live mode from `N+1`.
- *Caching* (§6.1): a closed Turn is immutable, so the serialized prefix
  `turns[0..k]` is byte-stable — a reliable `cache_control` segment.
- *Rendering*: the viewer draws the exact request for any turn N by calling
  `buildMessages()` over `{...session, turns: turns.slice(0, N)}`. One renderer.

`compacted` is declared and not yet consumed — the shape is reserved, the
behaviour is not implemented. Nothing reads it today.

### 3.8 Tracer

```ts
interface Tracer {
  start(goal: Goal, mode: string): Session;
  recordContext?(ctx: SessionContext): void;  // system, tools, initial observation
  openTurn(): Turn;
  flush?(): void;                             // persist mid-turn (stepped runs)
  closeTurn(turn: Turn): void;                // freeze, mark cacheable, time it
  finish(outcome, finalObservation, extra?): RunResult;
}
```

`InMemoryTracer` accumulates. `FileTracer` extends it and writes
`traces/live.json` on every state change (what the viewer tails) plus
`traces/<sessionId>.json` at the end (the durable replay artifact). Writes go
through a temp file and a rename, so a tailing reader never sees a torn file.

---

## 4. The loop (fixed)

`packages/core/src/agent.ts`, in order:

1. `tracer.start()`, and record `session.params` if the caller named any.
2. `env.observe()` — **guarded**. A dead environment ends the run with outcome
   `error` rather than crashing the host.
3. `mode.prepare?()` — may register mode-owned tools and make aux model calls.
4. `mode.system()`, then `tools.toModelSchema()` — in that order, so tools
   registered during `prepare()` appear in the schema list.
5. `tracer.recordContext()` — the static parts are now frozen into the trace.
6. For each step up to `mode.maxSteps`:
   - `env.observe()` again (from turn 1 on), also guarded. **The loop
     re-observes every turn**: the state a mode renders into its tail is
     current, not last turn's leftovers.
   - `tracer.openTurn()`.
   - `mode.composeTurn?()` → record `tail` / `stateAt` / `critic` onto the turn,
     then `tracer.flush()`. This is the write a stepped pause displays.
   - `mode.decide()` → thought, assistant blocks, tool uses, usage.
   - **No tool calls → outcome `stopped`.** The model stopped talking, which is
     not the same thing as the goal being met.
   - For each tool use: look it up (unknown → error result), `safeParse` the
     args (invalid → error result), `execute` inside a try/catch (a throw →
     error result). All three paths produce a `tool_result` the model reads.
   - `tracer.closeTurn()`.
   - An action setting `done` → outcome `completed`. **This is the only route
     to success.**
7. `tracer.finish()`.

The only thing that differs between modes is which `mode` object is passed in.

### Outcomes

```ts
type RunOutcome = "completed" | "stopped" | "max_steps" | "error";
```

`success` requires `completed` **and** a success-mapped completion status. A run
that goes quiet reports `stopped`. This matters because Success is a column
projected onto a wall.

---

## 5. The modes

`packages/modes`. All four satisfy §3.6 and none of them touch `agent.ts`.

| Mode | Model | Plan | Critic | Shape | Trades |
|------|-------|------|--------|-------|--------|
| **speed** | `claude-haiku-4-5` | ✗ | ✗ | volatile tail | latency/cost ↓, error rate ↑ |
| **accuracy** | `claude-opus-4-8` | ✓ | ✓ per turn | tail + plan + verdict | correctness ↑, slow and costly |
| **replay** | none | ✗ | ✗ | no prompt at all | deterministic, instant, free |
| **naive** | `claude-haiku-4-5` | ✗ | ✗ | state frozen into history | *deliberately wrong* — rung 1 |

- **speed** — one model call per turn. Current state rides the volatile tail,
  replaced every turn. No `thinking`, no `effort` (Haiku rejects `effort`).
- **accuracy** — plans once in `prepare()` and bakes the plan text into the
  system prompt, so it rides the cached prefix. Registers its own `update_plan`
  tool. Runs a critic on the previous turn inside `composeTurn()`, and puts the
  verdict, live plan progress, and failure-budget steering in the tail. Planner
  and critic usage lands in `session.auxUsage` so the money table is honest.
  Both aux calls use a forced `tool_choice` for structured output.
- **replay** — §6.
- **naive** — a chatbot loop pressed into service as an agent. Freezes the whole
  observation into history every turn and anchors the breakpoint at the very
  end. It is here to be **measured against**, not shipped.

`stepped(mode)` in `examples/step.ts` wraps any mode with a presenter gate.
It forwards `prepare`, `system`, and `composeTurn`, and keeps the inner mode's
`name` — so a stepped recording replays exactly like an unattended one.

---

## 6. Replay & tracing

**The `Session` you serialize is the replay program.** Replay walks the
recorded turns in order and re-issues their tool calls, never building a prompt
— which is exactly why the loop must not pre-build one (§2).

```ts
mode = replayMode(loadTrace(file).session, { fallback?, unknownTools?, params? })
```

### Param re-resolution

A recorded action's args are **not** all replayed literally:

```ts
type ArgSource =
  | { kind: "literal" }                              // reuse the captured value
  | { kind: "dom"; selector: string }                // re-read from the live page
  | { kind: "now" }                                  // recompute current time
  | { kind: "fromTurn"; turn: number; path: string } // a dot-path into THIS run
```

`fromTurn` resolves against the **replayed** turns of the current run, not the
recording — that is what keeps chained values live. Anything the environment
owns (`dom`, and any future kind) is delegated to `env.resolveArg()`.

`argSources` are reported by the **tool**, because the tool is what knows an arg
was an element handle rather than a constant. `BrowserEnv` is the main producer:
a click records `{kind:"dom", selector:"button|Add Titanium Tent Stakes to cart"}`
beside `elementId: 2`.

**A selector that matches nothing fails the call.** It does not fall back to the
recorded element id. That id is a positional handle from another run, and
reusing it means clicking whatever sits there now and reporting success — the
failure mode that costs the most, because it looks exactly like success.

### Re-pointing a recording (`session.params`)

A recording that knows what it was *about* can be re-run for a different
subject. `session.params` names the values (`item: "Titanium Tent Stakes"`), and
`replayMode({ params })` substitutes each recorded value for a new one in the
arguments passed **and** in the DOM selectors re-resolved. No model runs.

Three deliberate limits (`packages/core/src/rebind.ts`):

- Values under three characters are refused — substituting `"a"` everywhere is
  not a feature.
- The completion summary is never rewritten. No model runs during a replay, so
  that sentence belongs to the recorded model; substituting a name into it
  produces a fluent sentence with the recorded run's *numbers* still inside.
- An unmatchable selector fails loudly, per above.

### Unknown tools

A recording can contain calls to tools its *mode* registered rather than the
environment (accuracy's `update_plan`). Replay does not run that mode's
`prepare()`, so those tools are absent. Default policy `skip` drops the calls,
and drops a turn made up entirely of them — a turn with zero tool calls is how
the loop recognizes "the model stopped" and would end the run early.
`stub` keeps them instead, replaying each recorded result.

### Warm-start

When the trace runs out, an optional `fallback` mode takes over live from that
turn: replay `0..N`, live from `N+1`.

### 6.1 Turn-based incremental prompt caching

The same `Turn` structure makes long runs cheap. Render order is
`tools` → `system` → `messages`, and caching is a **prefix match** — any byte
change anywhere in the prefix invalidates everything after it.

**Two breakpoints per request, not four:**

1. On the system block, always (`model-anthropic` sets it). Because tools render
   first, this one breakpoint caches tools *and* system together.
2. On the last block of the most recent closed turn (`buildMessages`), so the
   growing frozen history stays warm.

**Placement discipline.** Current state is *never* frozen into history. It is
rendered fresh every turn and appended **after** the last breakpoint, where it
costs full price once and then falls away. History keeps only brief outcomes.
A tool result, by contrast, *is* frozen prefix — whatever a tool returns is said
permanently — which is why `BrowserEnv` tools return one line and `update_plan`
returns one line.

**Request layout is DATA, not code.** `session.contextShape` records which shape
a run used:

```ts
interface ContextShape {
  freezeState?: boolean;            // rung 1: freeze state into history
  cacheAt?: "last-turn" | "end";    // "end" is the "cache everything" instinct
}
```

`buildMessages` reads it, and so does the viewer. A mode that hand-rolled its
own messages would put the viewer one step behind the wire.

**The floor.** There is a **minimum cacheable prefix**, it is model-dependent,
and it is *not* monotonic across generations — 4,096 tokens on Haiku 4.5, 1,024
on Opus 4.8, 512 on Opus 5. Below it nothing caches: no error, no warning, just
`cache_read_input_tokens: 0` forever.

Good context construction walks straight into this. The whole discipline is to
keep bulk *out* of the frozen prefix, which leaves the prefix small. Measured on
this repo's ladder: the naive rung froze the page into history, ran a
62,000-token prefix, and cached beautifully; every well-built rung sat between
900 and 1,900 tokens and cached nothing.

The fix is counter-intuitive — **make the constant part bigger**. A real
operating guide (`packages/core/src/operating-guide.ts`) and the full tool
surface take the frozen prefix over the floor. It works only because those bytes
never change. `npm run floor` measures any recording's eligible prefix against
the floor, using `count_tokens` rather than `chars/4`, because an estimate on
the wrong side of a hard threshold answers the question backwards.

---

## 7. Environments

### 7.1 NotepadEnv

An in-memory list of lines, with `read_notepad` and `append_line`. Zero
dependencies, used by the spike, the drill, and the comparison. It exists so the
loop can be exercised with no browser, no network, and no key.

### 7.2 BrowserEnv (Playwright)

- `observe()` tags every visible interactive element with a `data-cad-id` and
  lists it as `[id] <tag> label`, alongside page text and the URL.
- Page text is **cleaned, not truncated**: the DOM is walked, never-content
  nodes are skipped, headings are kept so structure survives as text, and
  consecutive duplicates are dropped. A blunt character cut reads to the model
  as "the page doesn't contain that".
- A long page is previewed **head and tail**, because pages put navigation at
  the top and the things that change — carts, totals, results — at the bottom.
- Tools: `navigate`, `click`, `type_text`, `press_key`, `hover`,
  `select_option`, `read_element`, `scroll`, `go_back`, `go_forward`, `reload`,
  `find_in_page`, `wait_for_text`.
- `tools: string[]` restricts the offered surface. The environment owns this
  rather than the caller filtering afterwards, because `systemHint()` and the
  state block both talk about the tools — a hint that says "use `find_in_page`"
  when it was filtered out is a prompt naming a tool that does not exist.
- Element ids are **positional handles**, reassigned on every snapshot. This is
  the single most important thing the operating guide teaches the model.
- `resolveArg()` re-finds an element by its recorded `<tag>|<label>` signature
  on the live page — the producer side of §6.

### 7.3 StrudelEnv

Strudel is WebAudio-based, so it is hosted in a Playwright page with a
**vendored** bundle — no CDN at showtime. The env owns a map of named layers
plus a tempo, recompiled into one `stack(...)` program and re-evaluated on every
change. The model reasons over **structure**, since it cannot hear: `observe()`
reports tempo, the layer table, engine status, and whether drum samples loaded.

Evaluation errors come back as error tool results and the failed change is
**rolled back**, so the model self-corrects through the same path the drill
exercises. Because Strudel patterns are deterministic code, replaying a trace
reproduces the piece exactly.

---

## 8. Observability

- Every loop event is emitted through `onEvent` — `turn_start`, `thought`,
  `action`, `observation`, `done`.
- `FileTracer` writes `traces/live.json` continuously. The **viewer**
  (`packages/viz`) tails that file and renders the context anatomy: the request
  as it grows, block by block, each labelled by the request it belongs to. The
  agent loop contains zero UI code; the trace file is the only channel.
- The viewer also hosts the deck (`slides/*.md`) and a run control that
  **spawns the same CLI a terminal would**, stepping it by writing to stdin.
  That is a remote control, not a coupling: everything works with it off.
- `summarizeSession()` in core produces the one-line summary every surface uses
  — the `traces` listing, the `pin` picker, the money table, the viewer's
  session overview. One implementation, no drift.

**The money table** (`npm run compare`) runs the same goal under each mode:

| Mode | Wall-clock | LLM calls | Tokens | Cost | Right? |
|------|-----------|-----------|--------|------|--------|
| speed | … | … | … | … | … |
| accuracy | … | … | … | … | … |
| replay | … | 0 | 0 | $0 | … |

"Right?" is checked against the **world** — what is actually in the cart — not
against the model's summary. A run can report success and leave the cart wrong,
and that difference is half the point.

---

## 9. Repo layout

```
packages/
  core/            loop, Session/Turn/Action, tools, tracer, context builder,
                   operating guide, resilience decorators, rebind, summary
  model-anthropic/ the only provider-aware code (ModelClient → Claude)
  modes/           speed · accuracy · replay · naive
  tracer-file/     Session → disk; live.json to tail, <id>.json to replay
  testkit/         scripted model client + chaos wrappers (free, deterministic)
  viz/             context visualizer, deck, and run control (React + Vite)
  env-notepad/     trivial text environment
  env-browser/     Playwright environment
  env-strudel/     live-coded music environment
examples/          runnable demos, measurements, and the free checks
slides/            the talk, one file per slide; frontmatter binds recordings
traces/            recorded runs — replay artifacts and stage insurance
```
