---
sessions: sess_mtwyspf3_1, sess_mtwynn45_2, sess_mtwymgv0_2
run.label: try the trap live
run.script: examples/compare.ts
run.args: --goals b --modes speed
run.step: false
run.headed: false
run.note: one speed run against the trap — about 10 seconds and a cent
---

# Construction beats review

A task built to catch the cheap mode out: add all ten Camping and Climbing
items, then report the cart's total. Ten items trip a **$5 bundle discount that
is not printed on the product cards** — so the prices you already saw sum to
$690.08, while the cart charges $685.08. Work the number out and you are $5
wrong. Three runs of each mode:

| | runs | read the cart | added it up |
| --- | --- | --- | --- |
| speed | 3 | **3** | 0 |
| accuracy | 3 | **3** | 0 |

**It caught nobody** — because the cart total is re-observed into *every*
request. There is no stale number on the prompt to be fooled by, so there is
nothing for a critic to catch.

**Construction prevented the bug that review would have had to find.**

## What actually moves the bill

Every completed accuracy run of this one goal:

| how it clicked | turns | calls | cost |
| --- | --- | --- | --- |
| batched them (4 runs) | 3–4 | 6–8 | $0.147 – $0.188 |
| one at a time (2 runs) | 12 | 24 | $0.379 – $0.387 |

Nothing in the goal, the page or the harness chooses that. **A per-turn critic
multiplies whatever turn count the model happens to pick**, so accuracy's bill
is unpredictable rather than merely high. Speed took two turns every time,
every run, on both goals.

> And the cap is a cliff, not a net. I had `maxSteps` at 12 — one turn above
> this task's minimum — so two one-at-a-time runs ended at the cap with a full
> cart and no answer. That measured my configuration, not the mode. It is 18
> now.
>
> Pay for accuracy when the risk is in the **decision**, not when it is in the
> reading. Then budget for its variance, not its average.
