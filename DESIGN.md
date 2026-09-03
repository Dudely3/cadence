# Cadence — Architecture Design

> Working name: **Cadence** (rhythm for the music demo; pacing/timing for the speed-vs-accuracy thesis). Rename freely.

A minimal, domain-agnostic harness for agentic AI loops. Built to back the talk
**"Speed vs. Accuracy: Execution Modes for Agentic Workflows."**

---

## 1. Thesis

A good agent harness is **domain-agnostic**: the loop, the execution modes, and the
observability are fixed; only the **Environment** and its **Tools** change.

We prove this by driving two completely different worlds through the *same* core:

1. A **browser** (objective success: did the task complete?)
2. A **Strudel** live-coding music engine (subjective success: does it sound good?)

The same goal can be run under three **execution modes** — Speed, Accuracy, Replay —
and the tradeoff is made *visible and measurable* (wall-clock, LLM calls, tokens/cost,
success). That comparison is the centerpiece of the talk.

---

> **Dependency policy:** Cadence uses only open-source / publicly available packages
> (`@anthropic-ai/sdk`, `zod`, Playwright, Strudel, etc.). It shares **no code** with any
> proprietary/internal system. The `Session/Turn/Action` model below is a clean-room
> reimplementation of a general agent pattern, not a port of any internal codebase.

## 2. Design principles

- **The loop never changes.** Modes and environments are injected, not branched into.
- **Logging is the foundation, not a feature.** The trace you collect to debug is the
  exact artifact Replay mode consumes. Build it first; it pays off as a whole mode later.
- **Tools are typed.** Every tool has a schema; the model only ever emits validated calls.
- **Observation is explicit.** The agent perceives the environment through one method;
  no hidden global state leaks into the prompt.
- **Everything is streamable.** Each loop event is emitted so a dashboard can render
  `thought → tool call → observation` live.

---

## 3. Core abstractions

TypeScript. Interfaces first; implementations are swappable.

### 3.1 Goal & context

```ts
interface Goal {
  id: string;
  description: string;        // natural-language objective
  successCriteria?: string;   // optional, used by the verify step
}

interface RunContext {
  goal: Goal;
  step: number;
  history: TraceEvent[];      // prior steps this run
  plan?: PlanStep[];          // produced by Accuracy mode's plan phase
  scratch: Record<string, unknown>; // mode-private state
}
```

### 3.2 Observation & Action

```ts
// What the agent perceives each turn. Environment-specific payload.
interface Observation {
  summary: string;            // model-facing description of current state
  raw: unknown;               // structured detail (DOM snapshot, pattern AST, …)
}

// What the agent decides to do. An Action is always a validated tool call.
interface Action {
  tool: string;
  args: Record<string, unknown>;
  _meta?: ActionMeta;         // provenance for replay (see §6)
}

interface Decision {
  done: boolean;              // agent believes goal is met
  action?: Action;            // present unless done
  thought?: string;           // model rationale, for the dashboard
}

interface ActionResult {
  ok: boolean;
  observation: Observation;   // post-action state
  error?: string;
}
```

### 3.3 Tool & registry

```ts
interface Tool<A = any> {
  name: string;
  description: string;
  schema: ZodSchema<A>;       // validates args before execution
  execute(env: Environment, args: A, ctx: RunContext): Promise<ActionResult>;
}

interface ToolRegistry {
  list(): Tool[];
  get(name: string): Tool | undefined;
  toModelSchema(): ToolDefinition[]; // serialize to Anthropic tool-use format
}
```

### 3.4 Environment — *the key abstraction*

```ts
interface Environment {
  name: string;
  observe(): Promise<Observation>;
  availableTools(): Tool[];        // tools valid in this world
  reset(): Promise<void>;
  dispose(): Promise<void>;
}
```

`BrowserEnv` and `StrudelEnv` both implement this. **Swapping them is the demo that
proves the thesis.**

### 3.5 Model client

```ts
interface ModelClient {
  // Single decision turn: given context + tools, return a tool call or "done".
  decide(input: {
    system: string;
    context: RunContext;
    observation: Observation;
    tools: ToolDefinition[];
    model: string;            // e.g. claude-haiku-4-5 vs claude-opus-4-8
  }): Promise<Decision>;
}
```

> Model details (exact IDs, tool-use payload shape, prompt caching) get locked down
> against the current Claude API when we build §Phase 1 — not pinned here.

### 3.6 Execution mode — *the speed/accuracy knob*

The loop is fixed; the **mode** supplies policy. All hooks optional except `decide`.

```ts
interface ExecutionMode {
  name: "speed" | "accuracy" | "replay";
  model: string;                       // which Claude tier
  maxSteps: number;

  // Optional up-front planning (Accuracy uses it; Speed skips it).
  plan?(ctx: RunContext, obs: Observation): Promise<PlanStep[]>;

  // How to get the next action. Replay consults the cache here first.
  decide(ctx: RunContext, obs: Observation): Promise<Decision>;

  // Optional critic after each action. Returns pass/fail + feedback.
  verify?(ctx: RunContext, action: Action, result: ActionResult): Promise<Verdict>;

  // What to do on a failed verify or tool error.
  retry: RetryPolicy;                  // none | fixed(n) | untilVerified(max)
}

interface Verdict { ok: boolean; feedback?: string; }
```

### 3.7 Session / Turn / Action — *the unit of both replay and caching*

The run is modelled as a three-level hierarchy. This single structure is what makes
**replay** and **incremental prompt-caching** fall out of the same abstraction.

```ts
// One full run toward a Goal.
interface Session {
  id: string;
  goal: Goal;
  mode: string;
  turns: Turn[];
}

// One model round-trip: the model is invoked, returns a thought + 1..n tool calls,
// those execute into results. Maps 1:1 to an (assistant message, tool_result message)
// pair in the Messages API. A Turn is FROZEN once closed — its bytes never change.
interface Turn {
  index: number;
  thought?: string;
  actions: Action[];               // 1..n tool calls decided this turn
  closed: boolean;
  cacheable: boolean;              // eligible to anchor a cache breakpoint (set on close)
  compacted?: { summary: string }; // optional: replaces bulky tool results in LIVE context
  usage?: { model: string; inputTokens: number; outputTokens: number;
            cacheReadTokens?: number; cacheWriteTokens?: number };
  timing: { startedMs: number; durationMs: number };
}

// A single tool call within a Turn. `id` is stable so replay can match by identity.
interface Action {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  argSources?: Record<string, ArgSource>; // which args re-resolve on replay (see §6)
  result?: ActionResult;
}
```

**Why Turn is the right grain:**

- *Replay* (§6) walks `session.turns` in order, re-resolving `argSources` against the live
  environment. Turn granularity also enables **warm-start**: replay turns `0..N`, then hand
  off to the live model from turn `N+1`.
- *Caching* (§6.1): because a closed Turn is immutable, the serialized prefix `turns[0..k]`
  is byte-stable, so it's a reliable `cache_control` segment.
- *Long-turn efficiency*: a turn with huge tool results can be **compacted** to a summary in
  the live context once closed, while the full content stays in the trace for faithful replay.

### 3.8 Tracer / logger

The Tracer accumulates the `Session`; the serialized Session **is** the replay artifact.

```ts
interface Tracer {
  start(goal: Goal, mode: string): Session;
  openTurn(): Turn;                 // begins a turn (assistant about to be called)
  closeTurn(turn: Turn): void;      // freezes it, marks cacheable, records usage/timing
  finish(result: RunResult): Session;
}
```

---

## 4. The loop (fixed)

```ts
async function run(agent: {
  goal: Goal; env: Environment; tools: ToolRegistry;
  model: ModelClient; mode: ExecutionMode; tracer: Tracer;
}): Promise<RunResult> {
  const run = agent.tracer.start(agent.goal, agent.mode.name);
  const ctx: RunContext = { goal: agent.goal, step: 0, history: [], scratch: {} };

  ctx.plan = await agent.mode.plan?.(ctx, await agent.env.observe());

  for (; ctx.step < agent.mode.maxSteps; ctx.step++) {
    const obs = await agent.env.observe();
    const decision = await agent.mode.decide(ctx, obs);   // ← model OR cache
    if (decision.done) break;

    const tool = agent.tools.get(decision.action!.tool)!;
    const args = tool.schema.parse(decision.action!.args); // validate
    let result = await tool.execute(agent.env, args, ctx);

    let verdict: Verdict | undefined;
    if (agent.mode.verify) {
      verdict = await agent.mode.verify(ctx, decision.action!, result);
      if (!verdict.ok) result = await applyRetry(agent, ctx, decision, verdict);
    }

    const event = buildEvent(ctx, decision, result, verdict);
    run.record(event);
    ctx.history.push(event);
  }
  return run.finish(/* … */);
}
```

The only thing that differs between Speed, Accuracy, and Replay is which `mode`
object is passed in. That's the whole point.

---

## 5. The three modes

| Mode | Model | `plan` | `verify` | maxSteps | Trades |
|------|-------|--------|----------|----------|--------|
| **Speed** | `claude-haiku-4-5` | ✗ | ✗ | low | latency/cost ↓, error rate ↑ |
| **Accuracy** | `claude-opus-4-8` | ✓ | ✓ (critic each step) | high | correctness ↑, slow + costly |
| **Replay** | none / cheap fallback | ✗ | ✗ | from trace | deterministic + ~instant, known goals only |

- **Speed:** one model call per step, optimistic, no critic. Fastest path to "probably right."
- **Accuracy:** plans first, then runs the loop, running an LLM critic after each action and
  retrying with feedback until verified or budget exhausted. Slowest, most reliable.
- **Replay:** see §6.

---

## 6. Replay & tracing (the depth beat)

**Narrative:** logging isn't observability theater — the `Session` you serialize *is* the
replay program.

A trace is a serialized `Session` (§3.7) — an ordered list of `Turn`s, each holding its
`Action`s. Replay walks turns by index and re-resolves each action's args:

```ts
decide(ctx, obs) {
  const turn = this.session.turns[ctx.step];
  if (!turn) return this.liveFallback.decide(ctx, obs); // past the trace → warm-start live
  return { done: false, actions: turn.actions.map(a => reResolve(a, ctx, obs)) };
}
```

### Param re-resolution (the subtle, credible part)

A cached action's args are **not** all replayed literally:

- **Literal params** (a constant the model chose) → reused as-is.
- **Sourced params** (`_meta.source` on the arg, e.g. "read price from DOM node",
  "today's date", "value from prior step") → **re-resolved against the live environment**
  on every replay. This is what keeps replay robust instead of brittle.
- **Baked-in natural-language text** (descriptions, labels surfaced to a user) must be
  authored to describe the *role* of a value, not embed the captured literal — otherwise
  a replay shows last week's price next to this week's data.

```ts
type ArgSource =
  | { kind: "literal" }                                  // reuse captured value
  | { kind: "dom"; selector: string }                    // re-read from the live page
  | { kind: "now" }                                       // recompute current time
  | { kind: "fromTurn"; turn: number; path: string };    // pull from a prior turn's result
```

> Re-resolution is what separates robust replay from brittle record-and-playback:
> `argSources` params recompute against the live world; literals are reused; baked-in
> natural-language text paraphrases the *role*, never the captured value.

**Bonus framing — Replay is your demo insurance.** If the live model or browser flakes
on stage, switch to replay of a known-good trace and tell the audience it's a real
production feature, not a fallback hack.

### 6.1 Turn-based incremental prompt caching

The same `Turn` structure that powers replay also makes long runs cheap. The Messages API
caches prefixes via `cache_control` breakpoints (only **4** allowed), and bills cache reads
at a fraction of fresh input tokens.

- A closed `Turn` is **immutable**, so the serialized prefix `turns[0..k]` is byte-stable —
  a safe cache segment. Each new turn re-sends the whole history, but `turns[0..k]` is served
  from cache instead of re-processed.
- With only 4 breakpoints, anchor them at turn boundaries in a **laddered** scheme: one at the
  end of the system/tool preamble (never changes), and the rest sliding to cover the most
  recent stable turns. Longest warm prefix wins.
- **Long-turn compaction:** when a turn's tool results are huge, replace them with
  `turn.compacted.summary` in the *live* context after the turn closes. The live prompt stays
  small; the full bytes remain in the trace so replay is still faithful.

```ts
// Build Messages from a Session, anchoring cache breakpoints at chosen turn boundaries.
function buildMessages(session: Session, breakpoints: number[]): MessageParam[] {
  return session.turns.flatMap((t) => {
    const content = t.compacted ? summarize(t) : renderTurn(t);
    if (breakpoints.includes(t.index)) markCacheControl(content); // ephemeral cache point
    return content;
  });
}
```

Net effect: an N-turn run costs ~O(1) fresh input per turn instead of O(N), and Replay mode
reuses the *exact same* serialized turns. One structure, two payoffs.

---

## 7. Environments

### 7.1 BrowserEnv (Playwright)

- `observe()` → accessibility-tree / trimmed-DOM snapshot + URL + a short summary.
- Tools: `navigate(url)`, `click(target)`, `type(target, text)`, `read(selector)`,
  `waitFor(condition)`, `done(summary)`.
- Demo goal: a crisp, *stable* task on a sandbox site (e.g. "find the cheapest item in
  category X and add it to the cart"). Avoid live third-party sites — flake risk.
- "Accuracy" here is **objective**: did the cart contain the right item?

### 7.2 StrudelEnv

- Strudel is browser/WebAudio based → host it in a Playwright-driven page so the agent
  can actually *make sound* live. (Nice symmetry: the music env reuses the browser substrate.)
- `observe()` → current pattern source + a structural summary (tempo, layers, which
  instruments are active). The model reasons over **structure**, since it can't hear audio.
- Tools: `setTempo(bpm)`, `addLayer(name, pattern)`, `setSound(layer, instrument)`,
  `mutate(layer, transform)`, `play()`, `done(summary)`.
- Demo goal: "120 bpm house groove → add a bassline → add a riser into a drop."
- "Accuracy" here is **subjective**: the critic checks structural rules ("kick on every
  beat?", "bass in a sensible octave?") rather than ground-truth success. Great talking
  point about *what "accuracy" even means* across domains.
- Because Strudel patterns are deterministic code, **replaying a trace reproduces the
  song exactly** — and tweaking one cached tool call is a live **remix**. Strong finale.

---

## 8. Observability & metrics

- Every `TraceEvent` is emitted on a stream (EventEmitter → WebSocket).
- A small React dashboard renders the live loop: thought, tool call, observation, verdict.
- **The money slide:** run the same goal in all three modes and show a comparison panel:

  | Mode | Wall-clock | LLM calls | Tokens | Cost | Success |
  |------|-----------|-----------|--------|------|---------|
  | Speed | … | … | … | … | … |
  | Accuracy | … | … | … | … | … |
  | Replay | … | 0 | 0 | $0 | … |

  This single table *is* "Speed vs. Accuracy" made concrete.

---

## 9. Repo layout

```
cadence/
  packages/
    core/          # Agent loop, interfaces, Tracer, ModelClient
    modes/         # SpeedMode, AccuracyMode, ReplayMode
    env-browser/   # BrowserEnv + Playwright tools
    env-strudel/   # StrudelEnv + pattern tools
    dashboard/     # React live view + metrics table
  examples/
    browser-task.ts
    strudel-song.ts
  traces/          # serialized runs (replay artifacts)
  DESIGN.md
```

---

## 10. Build phases

0. **Spike** — bare loop + dummy env + one tool + Anthropic tool-use. Prove the cycle.
1. **Core** — typed tool registry (zod), structured Tracer, max-steps, error handling.
2. **Modes** — `ExecutionMode` abstraction + Speed + Accuracy.
3. **BrowserEnv** — Playwright tools; pick the stable demo goal.
4. **Replay** — serialize traces; param re-resolution; cache-miss fallback.
5. **StrudelEnv** — pattern tools + audio playback in a hosted page.
6. **Dashboard + metrics** — live loop view + the comparison table.
7. **Talk polish** — pre-recorded fallbacks, narrative, slide-to-demo choreography.

---

## 11. Open decisions

- **Verify granularity** in Accuracy mode: critic after *every* action vs. after the
  whole run vs. at plan-step boundaries. (Per-action is most dramatic on the dashboard.)
- **Observation signature** for replay lookup: exact match vs. fuzzy. Exact is simpler
  and fine for scripted demos; mention fuzzy as "the production hard part."
- **Strudel critic** rule set — how much music theory to encode vs. keep it loose.
- **Cost display** — live token accounting per mode, or pre-computed for the slide.
```
