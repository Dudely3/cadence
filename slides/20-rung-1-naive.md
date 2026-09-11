---
sessions: sess_mtpzblz6_1
run.label: run rung 1 live
run.script: examples/ladder.ts
run.args: --scenario shop --rung 1
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung, Haiku, about 5 cents
---

# Rung 1 — naive

**Raw DOM · frozen into history · one breakpoint at the very end**

| turns | peak prompt | total prompt | cost |
| --- | --- | --- | --- |
| 2 | 66,533 | 102,179 | $0.0486 |

Every choice here is the careful one. Keep the whole page. Keep every turn.
Cache everything. And the run *works* — it ends with the right cart, for half
what the next rung up costs.

**Look at the request beside this slide.** The request for turn 1 contains the
catalogue twice: as it was at turn 0, and as it is now. One of them is wrong.
Both are being sent.

| turn | fresh in | cache read | cache write |
| --- | --- | --- | --- |
| 0 | 3 | 35,643 | 30,887 |
| 1 | 3 | **35,643** | 30,887 |

**Six fresh tokens for the whole run.** Every request is a strict extension of
the last one, so the previous prompt is served from cache at a tenth of the
price. The cache is doing its job perfectly.

> Which is exactly why this rung is dangerous. It is cheap, it is correct, and
> the biggest single request doubles every turn. Nothing warns you. It works
> until the page is real — five slides from here.
