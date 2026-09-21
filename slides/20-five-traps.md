---
sessions: sess_mtwyspf3_1, sess_mtwymgv0_2, sess_mu8e6li1_1, sess_mu8e93lr_1
run.label: try a trap live
run.script: examples/compare.ts
run.args: --goals b --modes speed
run.step: false
run.headed: false
run.note: one speed run against the bundle-discount trap — about 10 seconds and a cent
---

# Five traps. Thirty-five runs. Nobody caught.

Every one of these was built to make the cheap mode confidently wrong, and
scored on the **world** — the cart, the page — never on the model's sentence.

| the bait | speed | accuracy |
| --- | --- | --- |
| a $5 bundle discount not printed on the cards, so the prices you saw sum $5 high | 3/3 read the cart | 3/3 |
| the ten-item total is destroyed by a step that has to come after it | 8/8 read it in time | 3/3 |
| a green **"Draft saved — DRAFT-7741"** panel with five steps still below it | 3/3 filed, 0 early | 3/3 filed, 0 early |
| a unit's condition visible only while you are looking at it | 3/3 clean | 3/3 clean |
| …and no disposition legal until all six are inspected | 3/3 clean | 3/3 clean |

**Thirty-five runs, zero catches.** And the third row is the one I would have
bet on: eleven ordered steps, and after the sixth the page shows exactly what a
finished request looks like on most real sites. A run that stops there calls
`complete` with a plausible reference number and reports success while the
return was never filed — **the failure no exception handler upstream will ever
see.** Not one run of thirty stopped there.

**They all failed for the same reason, and it is the reason this talk exists:**
current truth is re-observed into *every* request. The cart total, the item
list, `step 7 of 12` — all of it is rendered fresh after the cache breakpoint,
every turn. There is no stale number on the prompt to be fooled by, so there is
nothing for a critic to catch.

**Construction prevented the bug that review would have had to find.**

> Row 3 cost 15.6× to be *slower* — accuracy took 18, 19 and 20 turns against
> speed's 16, 16, 16 — because the page refuses every out-of-order pick with
> *"Choose X first."* The ordering that accuracy's planner exists to enforce was
> already enforced by the thing it was clicking on. Construction again, just
> somebody else's.
>
> One of these five did separate the modes. It did not do it by catching
> anybody.
