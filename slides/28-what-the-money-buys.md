---
sessions: sess_mtwbcjiv_1, sess_mtwbeeh3_3, sess_mtwbb5d1_2
run.label: try the trap live
run.script: examples/compare.ts
run.args: --goals b --modes speed
run.step: false
run.headed: false
run.note: one speed run against the trap — about 10 seconds and a cent
---

# What the extra money buys

I built a task to catch the cheap mode out. Add all ten Camping and Climbing
items, then report the cart's total. Ten items trips a **$5 bundle discount
that is not printed on the product cards** — so the prices you already saw sum
to $690.08, while the cart charges $685.08.

Report a number you worked out and you are $5 wrong. Three runs of each mode:

| | runs | read the cart | added it up |
| --- | --- | --- | --- |
| speed | 3 | **3** | 0 |
| accuracy | 3 | **3** | 0 |

**It caught nobody.** Not because the task is easy — because the cart total is
re-observed into *every request*. There is no stale number on the prompt to be
fooled by, so there is nothing for a critic to catch. That is the ladder's
lesson arriving from the other direction: construction prevented the bug that
review would have had to find.

## The thing it did catch

The same goal, the same model, three runs of accuracy mode:

| accuracy run | turns | calls | cost |
| --- | --- | --- | --- |
| #1 | 3 | 6 | $0.1528 |
| #2 | 12 | 24 | $0.3787 |
| #3 | 12 | 24 | $0.3868 |

Run 1 batched its ten clicks into three turns. Runs 2 and 3 clicked one at a
time. Nothing about the input changed — and **a per-turn critic multiplies
whatever turn count the model happens to pick**, so the bill moved 2.5×. Speed
took two turns every single time.

> Pay for accuracy when the risk is in the **decision**, not when it is in the
> reading — construction already covers the reading. And when you do pay,
> budget for the variance rather than the average: per-turn overhead turns the
> model's choice of batching into your invoice.
