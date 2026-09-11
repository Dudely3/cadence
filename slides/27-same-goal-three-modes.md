---
sessions: sess_mtwba6k9_1, sess_mtwbac3v_2
run.label: run all three live
run.script: examples/compare.ts
run.args: --goals a
run.step: false
run.headed: false
run.note: speed, then accuracy, then a free replay — about 25 seconds and 11 cents
---

# Same goal, three modes

Add the cheapest item in the Camping category. One right answer — Titanium Tent
Stakes, $11.50 — checked against the cart, not against the model's sentence.

| | speed | accuracy | replay |
| --- | --- | --- | --- |
| model | Haiku 4.5 | Opus 4.8 | none |
| turns | 2 | 2 | 2 |
| model calls | 2 | 4 | **0** |
| wall clock | 7.1s | 14.0s | 2.6s |
| cost | $0.0115 | **$0.1002** | **$0.0000** |
| right cart | ✓ | ✓ | ✓ |

**8.7× the cost and 2× the wall clock for the same item in the cart.**

Same loop, same tools, same page, same operating guide — measured in one run of
`npm run compare`, so the only variable is the policy. Both live recordings are
bound to this slide: open either and every number above is inside it.

- **Speed** is the default, because most steps are not hard.
- **Accuracy** adds a planner call before turn 0 and a critic call after each
  closed turn. Here that is 2 extra calls for zero extra correctness.
- **Replay** re-executes the speed run's trace. No model, no tokens, and it put
  the same thing in the cart.

> Which is a strange advertisement for a talk called Speed vs. Accuracy, so the
> honest question is the next slide: what *does* the extra money buy?
