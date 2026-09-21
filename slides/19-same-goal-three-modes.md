---
sessions: sess_mtwylhja_1, sess_mtwylnxp_2
run.label: run all three live
run.script: examples/compare.ts
run.args: --goals a
run.step: false
run.headed: false
run.note: speed, then accuracy, then a free replay — about 25 seconds and 12 cents
---

# Same goal, three modes

Add the cheapest item in the Camping category. One right answer — Titanium Tent
Stakes, $11.50 — checked against the cart, not against the model's sentence.

| | speed | accuracy | replay |
| --- | --- | --- | --- |
| model | Haiku 4.5 | Opus 4.8 | none |
| turns | 2 | 2 | 2 |
| model calls | 2 | 4 | **0** |
| wall clock | 8.2s | 15.7s | 2.7s |
| cost | $0.0118 | **$0.1039** | **$0.0000** |
| right cart | ✓ | ✓ | ✓ |

**8.8× the cost and 1.9× the wall clock for the same item in the cart.**

Same loop, same tools, same page, same operating guide — one run of
`npm run compare`, so the only variable is the policy. Both recordings are
bound to this slide: open either and every number above is inside it.

- **Speed** is the default, because most steps are not hard.
- **Accuracy** spent 2 extra calls here for zero extra correctness.
- **Replay** re-executes the speed run's trace. No model, no tokens, and it put
  the same thing in the cart.

> Which is a strange advertisement for a talk called Speed vs. Accuracy. So I
> built five traps to catch the cheap mode out.
