---
sessions: sess_mtyus7an_1, sess_mtyushk9_2, sess_mtyusqcl_3, sess_mtyusy0t_4
run.label: run the whole ladder
run.script: examples/ladder.ts
run.args: --scenario shop
run.step: false
run.headed: false
run.note: 4 live runs, roughly 25 cents and a few minutes — the per-rung slides run one at a time
---

# The context ladder

Same goal. Same loop. Same page. Same model. Same tools. **Only the context
strategy changes.** Every rung finished with the correct cart.

| rung | turns | peak prompt | total | cost |
| --- | --- | --- | --- | --- |
| 1. naive | 3 | 97,024 | 199,084 | *$0.1346* |
| 2. + volatile tail | 2 | 36,060 | 71,686 | $0.0714 |
| 3. + cleaned page | 2 | 19,137 | 37,839 | $0.0312 |
| 4. + let it explore | 3 | **10,295** | **27,277** | **$0.0216** |

**97,024 → 10,295 tokens in the biggest single request. 89% smaller.**

Each rung is one idea:

- **2** — stop freezing state into history; re-observe and put it past the
  cache line, replaced every turn
- **3** — drop the markup the model was never reading
- **4** — stop shipping the page at all; send a small window and let the model
  search for the rest

**Read the turns column before the cost column.** Rungs 1 and 2 swap places
depending on which one happens to take an extra turn — a coin toss, and the
rung 2 slide has the token accounting that shows why. **3 and 4 beat both every time**,
and that is the claim worth making.

> `npm run ladder` runs all four and writes four traces — the four bound to
> this slide. The next three slides walk the rungs, with each one's recording
> already open beside it.
