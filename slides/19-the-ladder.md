---
sessions: sess_mtpzblz6_1, sess_mtpzbuj8_2, sess_mtpzc5h6_3, sess_mtpzh925_1
run.label: run the whole ladder
run.script: examples/ladder.ts
run.args: --scenario shop
run.step: false
run.headed: false
run.note: 4 live runs, roughly 20 cents and a few minutes — the per-rung slides run one at a time
---

# The context ladder

Same goal. Same loop. Same page. Same model. Same tools. **Only the context
strategy changes.** Every rung finished with the correct cart.

| rung | turns | peak prompt | total | cost |
| --- | --- | --- | --- | --- |
| 1. naive | 2 | 66,533 | 102,179 | $0.0486 |
| 2. + volatile tail | 3 | 36,077 | 107,626 | *$0.0980* |
| 3. + cleaned page | 3 | 19,154 | 56,864 | $0.0464 |
| 4. + let it explore | 3 | **9,430** | **25,498** | **$0.0149** |

**66,533 → 9,430 tokens in the biggest single request. 86% smaller.**

Each rung is one idea:

- **2** — stop freezing state into history; re-observe and put it past the
  cache line, replaced every turn
- **3** — drop the markup the model was never reading
- **4** — stop shipping the page at all; send a small window and let the model
  search for the rest

**Look at rung 2's cost.** It sends half as many tokens in its biggest request
as rung 1, and costs twice as much. That is not a typo, and it is the most
interesting line on the slide.

> `npm run ladder` runs all four and writes four traces — the four bound to
> this slide. The next four slides take one rung each, with that rung's
> recording already open beside it.
