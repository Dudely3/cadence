---
sessions: sess_mtes6cyx_1, sess_mtyqcsi4_1, sess_mtwyspf3_1, sess_mtwynn45_2
run.label: run accuracy mode live
run.mode: accuracy
run.step: true
run.headed: true
run.note: Opus with plan + critic — more turns to narrate, about 20 cents
---

# Accuracy mode, mechanically

Same loop, same tools, same environment. Only the **policy** changed.

This is what review costs to build. Keep the price in view — the rest of the
talk is about whether your risk is the kind that pays for it.

- **Plan first.** Before turn 0, a planner call breaks the goal into steps with
  dependencies. The plan text is baked into the system prompt — so it lands in
  the *cached prefix* and costs nothing after the first turn.
- **`update_plan` is a real tool.** The model marks steps done, and the tool
  **refuses** to mark a step whose dependencies are still pending.
- **A critic reviews every turn.** After each step, a separate call with a
  forced tool choice judges whether the result matched the stated intent, and
  its verdict is appended to the volatile tail.
- **A failure budget.** Consecutive failures push the model toward
  `complete(status: failed)` instead of flailing until the step cap.

**The call accounting, from a real 3-turn run:**

| | calls |
| --- | --- |
| planner (once, before turn 0) | 1 |
| decide (one per turn) | 3 |
| critic (one per closed turn) | 2 |
| **total** | **6** |

**Three turns of work, six model calls.** Speed would have made three. The
next slide prices that; this slide is where the calls come from.

## The bill is unpredictable, not merely high

Six accuracy runs of one goal — add ten items, report the cart's total:

| how it clicked | turns | calls | cost |
| --- | --- | --- | --- |
| batched them (4 runs) | 3–4 | 6–8 | $0.147 – $0.188 |
| one at a time (2 runs) | 12 | 24 | $0.379 – $0.387 |

Nothing in the goal, the page or the harness chooses that. **A per-turn critic
multiplies whatever turn count the model happens to pick** — so a 2.6× spread
on an identical task is the mode working as designed. Speed took two turns
every time.

> And the step cap is a cliff, not a net. `maxSteps` was 12 — one turn above
> this task's floor — so both one-at-a-time runs ended at the cap with a full
> cart and no answer. That measured my configuration, not the mode. It is 18
> now.
>
> **Budget for accuracy's variance, not its average.**
