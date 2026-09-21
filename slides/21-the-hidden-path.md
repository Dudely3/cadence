---
sessions: sess_mu2ohlqd_4, sess_mu2opvpu_1, sess_mu2ocyzb_1, sess_mu2oeodd_2
run.label: run the trap that worked
run.script: examples/compare.ts
run.args: --goals c --modes speed
run.step: false
run.headed: false
run.note: one speed run on the ordering trap — a cent or two, and it fails seven times in eight
---

# The one construction can't prevent

That was row 2: same ten items, one clause added — **then leave the cart
holding only the cheapest Climbing item.** The page has no per-item remove,
only *Clear cart*, so the ten-item total has to be read **before** the step
that destroys it.

All eleven runs read it in time. **What split the modes was converging at
all.**

| | runs | converged |
| --- | --- | --- |
| speed | 8 | **1** |
| accuracy | 3 | **3** |

Being right here is a property of *order*, and the order is not in the request.
It has to be decided.

- `sess_mu2oeodd_2` spent twenty turns hunting a per-item remove control that
  does not exist, ending on three identical `find_in_page` calls.
- `sess_mu2ocyzb_1` **found** clear-and-re-add on turn 3 — then re-added all
  ten instead of the one, and cleared again on turns 3, 7, 9, 11, 13, 15, 17,
  19 and 21. A livelock, not a search.

**And this is not the step-cap mistake repeating.** The cap went from 22 to 40
and the rate did not move: the one speed run that finished took 16 turns, well
under the *original* cap, while runs at 40 burned all forty. More turns bought
nothing, because the failures are not slow — they are stuck.

> **Credit the planner, not the critic.** Accuracy's plan named the target and
> the order before turn 0 — *"read and record the cart's ten-item total (needs
> s1)"*, *"remove all items except the cheapest Climbing item (needs s2)"* — so
> the path speed had to discover was handed over as a premise.
> `update_plan`'s dependency gate was armed and never had to fire.
>
> **That is the boundary.** Construction prevents the bug when the fact is
> re-observable. When what is missing is the *path*, there is nothing to
> observe, and decomposition is what you are buying.
