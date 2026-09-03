# Exercises — getting the loop into your hands

Baseline: `npm run drill` — 9 fault scenarios, free, no API key.
Current state: **harness holds in 9/9.**

---

## Done (hardening — mechanical, low conceptual content)

These four were transport and bookkeeping fixes. Read the diffs; don't re-derive them.

**1. Honest success semantics.** `types.ts` now has a `RunOutcome`:
`completed` | `stopped` | `max_steps` | `error`, and `success === outcome === "completed"`.
The only route to `completed` is an action setting `done` — i.e. the model explicitly
calling a `finish` tool, same contract as Solo. A model that just stops talking now
reports `stopped`, which is what the `bareText` row shows.

Why it mattered: *Success* is a column you are going to project onto a wall.

**2. Guarded `tool.execute`.** `agent.ts` catches a throwing tool and converts it to an
error `tool_result`, same contract as the unknown-tool and invalid-args paths. This is
the Playwright case — element-not-found and timeouts throw constantly.

**3. Retry.** `resilience.ts` → `withRetry`, exponential backoff with jitter, retries
408/409/429/5xx and timeouts. Retried 429s aren't billed, so the token columns stay
honest; wall-clock already captures the cost.

**4. Timeout.** `withTimeout`, plus `resilient()` which composes both. Both `spike.ts`
and `drill.ts` now use `resilient(client)`. A hang becomes a timeout becomes a retry.

Also: `env.observe()` is guarded, so a dead environment returns `outcome: "error"`
instead of crashing the process.

These are decorators, not loop changes — `DESIGN.md` §2 says the loop never changes,
and it still doesn't. Pull the `resilient()` wrapper out of `drill.ts` and the transport
rows go red again, which is the point of keeping the drill around.

---

## 5. Invert `ExecutionMode` from config to policy — **done (Aug 10)**

`ExecutionMode` is now a policy object (`packages/core/src/mode.ts`):

```ts
name; maxSteps;
prepare?(deps + observation)   // accuracy plans here, before the prefix freezes
system({goal, env, ctx})       // composed by the mode, recorded into the Session
decide({session, observation, goal, env, tools, model, ctx}): Promise<ModelResult>
```

The loop never builds a prompt — it passes deps and the mode decides. Speed and
accuracy call `buildMessages(session)`/`composeSystem` as library functions and keep
their model tier / maxTokens / thinking / effort as private closure config; replay
will implement `decide()` by walking the recorded session, never building a prompt at
all. Both modes read `session.system`/`session.tools` back off the trace, so the wire
and the trace are the same bytes by construction.

Deliberately NOT in the interface: `verify`/`retry` hooks. A failed tool call is an
observation; how many consecutive failures a mode tolerates is private policy in
`ctx.scratch` (settled decision #4). The accuracy critic (row 5) will live inside its
`decide()`, not as a loop hook.

Verified: drill 9/9 unchanged, live spike identical, typecheck clean.

Worth reading as a diff: `mode.ts`, `agent.ts`, `modes/speed.ts` — the loop shrank.

---

## 6. Record, then replay — **done (Aug 16)**

`replayMode(source, {fallback?})` in `@cadence/modes` walks a recorded Session's turns
and re-issues its tool calls — never building a prompt (which is why the loop doesn't).
`loadTrace(file)` in `@cadence/tracer-file` reads a trace back. Re-resolution engine:
`literal` (reuse) / `now` (recompute) / `fromTurn` (dot-path into THIS run's replayed
turns) / anything else → `env.resolveArg()`. Warm-start = fallback mode takes over when
the trace runs out.

**Still open, deliberately:** nothing POPULATES `argSources` yet. That starts with
BrowserEnv (dom-sourced args) — the engine is ready and waiting.

Run `npm run compare` for the three-mode money table (speed live → accuracy live →
replay of the speed trace): the replay row is 0 calls, 0 tokens, $0.

---

## Open questions worth deciding, not working around

- **The loop never re-observes.** `agent.ts` calls `env.observe()` once, before the first
  turn; state changes reach the model only through tool results. `DESIGN.md` §4 observes
  every iteration. Both are defensible — but a browser page changes without you touching
  it, so decide this before BrowserEnv rather than during.

- **Cache breakpoints.** `context.ts` anchors one, on the most recent closed turn; the
  design describes a laddered four-breakpoint scheme. Cache reads are still 0 because the
  notepad prefix is under Haiku's 4096-token minimum, so the caching claim is unproven.
  BrowserEnv will clear that bar and give you a real number.

- **Scope.** The React dashboard in `DESIGN.md` §8 is the likeliest thing to eat three
  weeks you don't have. The terminal renderer in `spike.ts` already shows
  thought → action → observation, and the comparison table can just be printed.
