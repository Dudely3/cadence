# Exercises — getting the loop into your hands

The fastest way to understand a harness is to break it somewhere specific and
watch which check goes red. Every exercise below is reversible with
`git checkout`, and each one names the command that tells you whether you were
right.

Baseline first — free, no API key, about ten seconds:

```bash
npm run check
```

That is typecheck plus the four scripted checks. `npm run drill` on its own
prints the most legible output: nine injected faults, and whether the harness
held. It should say **9/9**.

Exercises marked **$** cost real money. Everything else is free.

---

## 1. Take the safety net away

`examples/drill.ts` wraps its model client in `resilient()`. Remove the wrapper
— call `scripted()` directly in the `guard` helper — and run `npm run drill`.

The three transport rows (`rateLimit`, `overloaded`, `hang`) go red, and `hang`
stops the run dead until the drill's own deadline fires. Put it back.

**What it teaches.** Retry and timeout are `ModelClient` **decorators**, not
loop code. The loop never learned about HTTP status codes, and adding
resilience did not change `agent.ts`. That is the same seam `chaos()` wraps to
inject the faults in the first place.

---

## 2. Drop below the cache floor

Open `packages/core/src/operating-guide.ts` and delete most of it — keep the
first section, throw away the rest. Then:

```bash
npm run floor
```

**$** — this one costs a token count per trace, not a completion.

Every recording's eligible prefix drops under Haiku 4.5's 4,096-token floor, and
the report says so. Nothing errors. Nothing warns. A live run would just report
`cache_read_input_tokens: 0` forever.

**What it teaches.** The minimum cacheable prefix is a hard threshold, it is
model-dependent, and it is not monotonic across generations. Good context
construction keeps bulk *out* of the frozen prefix, which is exactly what walks
you into this. The counter-intuitive fix is to make the constant part bigger.

---

## 3. Freeze the state into history

`naiveMode` already does this, which is why it exists. Read
`packages/modes/src/naive.ts` beside `packages/modes/src/speed.ts` — they differ
in about fifteen lines.

Then run the ladder's first two rungs and compare the traces in the viewer:

```bash
npx tsx examples/ladder.ts --rung 1
```

```bash
npx tsx examples/ladder.ts --rung 2
```

Both **$**. Call `tsx` directly rather than `npm run ladder -- --rung 1`:
PowerShell strips the `--`, npm swallows the flags as its own config, and the
script runs with defaults — silently, which is the worst way to be wrong.

**What it teaches.** Rung 1's prompt is append-only, so the whole run is billed
almost entirely as cache reads and it looks cheap. Rung 2 does the right thing —
state past the cache line, replaced every turn — and by definition that moves
the expensive part outside the cached prefix, where it is billed fresh. The
argument for rung 2 is that the peak prompt stops growing, not that the invoice
shrinks. Read the ladder table before you decide which number matters.

---

## 4. Put something in a tool result

Make `BrowserEnv`'s `click` tool return the full page snapshot instead of one
line — `observation: { summary: (await this.observe()).summary }`. Record a run,
then open it in the viewer and step through the turns.

**What it teaches.** A tool result **is** frozen prefix. Whatever a tool returns
is said permanently and re-read on every later turn. One snapshot per click
accumulates into a pile of contradictory page states, all of them stale except
the last, all of them billed on every turn after.

This is not hypothetical: `update_plan` used to echo the whole plan, and
`npm run deps` now has an assertion that fails if it starts again. Try making
`updatePlanTool` verbose in `packages/modes/src/accuracy.ts` and watch
`plan NOT frozen in history` flip to FAIL.

---

## 5. Break the one-renderer rule

In `packages/modes/src/speed.ts`, stop calling `buildMessages(session, {tail})`
and hand-roll the messages array instead — append an extra text block the
builder does not know about. Run something and watch it in the viewer.

The request goes out with your block in it. The viewer draws the request
*without* it, because the viewer can only call `buildMessages`.

**What it teaches.** One message builder, or the picture and the wire diverge.
This is also why request *layout* is data (`session.contextShape`) rather than
private knowledge inside a mode: the viewer reads the shape off the trace and
draws a naive run correctly without knowing naive mode exists.

---

## 6. Make a recording lie

Record a run, then re-point it at a product that is not on the page:

```bash
npx tsx examples/rerun.ts --replay latest --items "Nonexistent Widget"
```

The re-pointed selector matches nothing, and the call **fails**. It does not
fall back to the recorded `elementId`.

Now make it fall back: in `packages/modes/src/replay.ts`, delete the `UNRESOLVED`
branch so an unmatchable selector keeps the recorded value. Re-run.

The replay now clicks whatever happens to sit at that position today, reports
success, and leaves the wrong thing in the cart.

`npm run rerun` is what catches this. It ends by re-pointing at an item that
does not exist and asserting both that the call errored and that the cart stayed
empty. Note which check does *not* catch it: `npm run replay` drives the
notepad, and a notepad has no `resolveArg` — so the selector path it exercises
is the one that cannot fail this way.

**What it teaches.** A recorded element id is a positional handle from another
run. Reusing it converts a loud failure into a confident wrong answer, which is
the most expensive failure mode available — nothing downstream can detect it.

---

## 7. Add a tool

Give `NotepadEnv` a `delete_line(index)` tool. It is about fifteen lines:
a zod schema, an `execute` that mutates and returns a brief `ActionResult`, and
one more entry in `availableTools()`.

Then run `npm run spike` (**$**) and ask for something that needs it.

**What it teaches.** The whole surface a tool needs: typed args validated before
execution, a brief observation rather than a state dump, and nothing else. Note
what you did *not* have to touch — the loop, the modes, the tracer, the viewer.

---

## 8. Add an environment

Implement `Environment` over something you have lying around — a filesystem
directory, a SQLite database, a REST API. The interface is six methods and four
of them are optional:

```ts
name; observe(); availableTools(); systemHint?; resolveArg?; reset?; dispose?
```

Copy `examples/spike.ts`, swap `NotepadEnv` for yours, and run it. **$**

**What it teaches.** This is the thesis, and it is the exercise worth doing.
If the loop, the modes, the tracer, and the viewer all work against your new
world without modification, the abstraction held. If you found yourself wanting
to special-case something in `agent.ts`, that is worth understanding — it is
usually a sign the work belongs in a tool, a `systemHint()`, or a mode.

---

## 9. Write a mode

Modes are where policy lives, and the interface is small: `name`, `maxSteps`,
`system()`, `decide()`, and optionally `prepare()` and `composeTurn()`.

Some that do not exist yet:

- **Budget mode** — track spend from `turn.usage` and steer toward completion
  when a dollar ceiling is near. The tail is where the steering goes.
- **Escalating mode** — Haiku until a turn fails, then Opus for the retry.
  Both tiers are just a `model` string inside `decide()`.
- **Compacting mode** — `Turn.compacted` is declared in `turn.ts` and nothing
  reads it. Implement it: when a closed turn's results are bulky, replace them
  in the *live* context with a summary while the full bytes stay in the trace,
  so replay is still faithful. This needs a change in `buildMessages`, which is
  the one place it belongs.

**What it teaches.** Whether the mode seam is actually load-bearing. If you can
write one of these without touching `agent.ts`, it is.

---

## Ground rules for any change

- `npm run check` before and after. It is free and it takes seconds.
- If you change the operating guide or the tool surface, run `npm run floor`.
- If you change anything about prompt construction, open the viewer and look at
  a request. The trace is supposed to *be* what went on the wire, and the only
  way to know it still is, is to look.
