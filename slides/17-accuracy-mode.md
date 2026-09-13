---
sessions: sess_mtes6cyx_1, sess_mtyqcsi4_1
run.label: run accuracy mode live
run.mode: accuracy
run.step: true
run.headed: true
run.note: Opus with plan + critic — more turns to narrate, about 20 cents
---

# Accuracy mode, mechanically

Same loop, same tools, same environment. Only the **policy** changed.

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

Three turns of work, six model calls. Against the speed run of the same task,
also bound to this slide, that is **14× the cost** — $0.0943 against $0.0068.
The requests column shows where it goes, call by call, and the last slide in
the deck puts all three modes side by side.
