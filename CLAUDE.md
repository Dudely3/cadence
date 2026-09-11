# Working in this repo

Cadence is a minimal, domain-agnostic harness for agentic AI loops, built to
back a conference talk about context management, prompt caching, and replay. It
is **teaching code**: it is read at least as often as it is run, and a comment
explaining why something is counter-intuitive is load-bearing, not decoration.

Two documents matter more than this one:
[`DESIGN.md`](./DESIGN.md) is the architecture, and its section numbers are
cited from source comments. [`README.md`](./README.md) is how to run things.

---

## Read these first, in this order

| File | What you learn |
|---|---|
| `packages/core/src/agent.ts` | The whole loop, comments included. No branching on mode. |
| `packages/core/src/mode.ts` | The mode interface, and the division of labor. |
| `packages/core/src/turn.ts` | `Session`/`Turn`/`Action` — replay and caching both fall out of this. |
| `packages/core/src/context.ts` | `buildMessages` — the one and only prompt renderer. |
| `packages/modes/src/speed.ts` | The simplest complete mode, ~60 lines. |
| `packages/modes/src/naive.ts` | The same thing done deliberately wrong, for contrast. |

`packages/core/src/operating-guide.ts` is a large block of prose. Read its
header comment before deciding it is too long — its size is the point.

---

## Invariants

These are the claims the talk makes. Breaking one silently is worse than
breaking it loudly, so most have a check attached.

1. **The loop never branches on mode.** No `if (mode.name === …)` in
   `agent.ts`. A new mode is a new object, not a new branch.

2. **The loop never builds a prompt.** Composing the request is the mode's job.
   Replay produces decisions with no prompt existing at all; a loop that
   pre-built one would make replay a special case.

3. **There is exactly one message builder.** Everything that renders a request
   calls `buildMessages()` — including the viewer. If you need a different
   request *layout*, add a field to `ContextShape` and teach `buildMessages`
   about it. Do not hand-roll a messages array inside a mode.

4. **The trace is what went on the wire.** A `Session` must be a complete
   account of what the model saw. Modes read `session.system` and
   `session.tools` back off the trace rather than recomputing them, so the two
   cannot drift.

5. **Volatile content goes past the cache breakpoint.** Current state is
   rendered fresh every turn and appended after the last breakpoint. It is
   never frozen into history. `naiveMode` is the only exception and exists to
   be measured against.

6. **A tool result is frozen prefix.** Whatever a tool returns is said
   permanently and re-read on every later turn. Tool results are brief
   confirmations — "Clicked [2] button · Add X to cart" — never state dumps.
   `npm run deps` asserts this for `update_plan`.

7. **The frozen prefix must stay over the model's cache floor.** 4,096 tokens
   on Haiku 4.5. If you shorten the operating guide or trim the tool surface,
   run `npm run floor`.

8. **Failures are observations.** Unknown tool, invalid args, and a throwing
   tool all become an error `tool_result` the model reads. Only transport
   failures are handled outside the model's view, as `ModelClient` decorators
   (`resilient()`). Do not add error handling to the loop.

9. **Only an explicit `done` counts as success.** A model that stops calling
   tools reports `stopped`, not success. Do not "fix" this.

10. **A replay never falls back to a recorded element id.** An unmatchable
    selector fails the call. Reusing the id turns a loud failure into a
    confident wrong answer.

---

## Before you finish

```bash
npm run check
```

Typecheck plus four scripted checks. Free, no API key, no network, seconds.

| Command | Covers |
|---|---|
| `npm run typecheck` | Whole workspace, including the viewer. |
| `npm run deps` | Plan dependency enforcement, critic recording, prefix hygiene. |
| `npm run replay` | Replay fidelity, including mode-owned tools and re-pointing. |
| `npm run drill` | Nine injected faults. Must report **9/9**. |
| `npm run slides` | Every slide's bound recordings and launchable runs still resolve. |

**Do not run these without asking — they make real API calls:** `spike`,
`recover`, `compare`, `browse`, `jam`, `demo`, `demo:accuracy`, `try`,
`cachelab`, `formatlab`, `ladder`, `ladder:web`, `ladder:rung`, `rerun`.
`floor` costs a token count per trace and no completions, which is cheap but
not free. `rerun --replay latest` skips its one paid run and is then free.

Free alongside the checks: `traces`, `pin`, `viz`, `demo:replay`.

If you change prompt construction, also open the viewer (`npm run viz`) and look
at an actual request. The checks verify structure; only looking verifies that
the picture still matches the wire.

---

## Environment gotchas

- **Node 20.12+.** `examples/env.ts` uses `process.loadEnvFile`.
- **Playwright browsers are a separate install:** `npm run setup`. None of the
  five free checks need them; every browser demo does.
- **Never write `npm run <script> -- --flag`.** On PowerShell the `--` is
  stripped, npm swallows the flags as its own config, and the script runs with
  defaults *silently*. Call `npx tsx examples/<file>.ts --flag` instead. The
  ready-made `demo`, `demo:accuracy`, and `demo:replay` scripts exist for this
  reason.
- **`.env` is optional.** Replay, scripted runs, and every free check work
  without a key. Shell values beat `.env`.
- **`ANTHROPIC_WORKSPACE_ID`** is required only for identity-linked keys. The
  model client translates that 400 into a readable message.

---

## Conventions

- **TypeScript, strict, with `noUncheckedIndexedAccess`.** Array access gives
  you `T | undefined`; handle it rather than asserting it away.
- **`@cadence/*` workspace packages import from source**, not from a build.
  There is no build step for the libraries.
- **Provider-specific code lives in exactly one file**:
  `packages/model-anthropic/src/index.ts`. Core speaks a neutral content-block
  union. Do not import the Anthropic SDK anywhere else.
- **Comments explain *why*, especially when the code looks wrong.** Several
  things here are deliberately counter-intuitive — a deliberately large system
  prompt, a deliberately terse tool result, a mode that is deliberately bad.
  Each carries a comment saying so, usually with the measurement that settled
  it. Preserve those when you edit nearby.
- **Text files are LF**, enforced by `.gitattributes`.

## Things that are not bugs

- `naiveMode` is bad on purpose. It is rung 1 of the context ladder.
- `traces/example-rag-chatbot.json` and `example-solo-legacy.json` are
  hand-written, not captured. They exist so another architecture can be put
  beside a real run, and they set `session.presentation` to say which drawing
  convention they use. Live runs never set it.
- `Turn.compacted` is declared and unread. The shape is reserved; the behaviour
  is not implemented. See exercise 9 in [`EXERCISES.md`](./EXERCISES.md).
- The operating guide is long. See invariant 7.
- `traces/` is committed. Recorded runs are the offline fallback for a live
  talk, and `slides/pins.json` binds some of them to slides.
