---
sessions: sess_mtqbtgu6_1
run.label: re-point it live
run.script: examples/rerun.ts
run.args: --replay latest
run.paramFlag: --items
run.paramLabel: Product
run.paramValue: Camp Stove
run.step: false
run.headed: true
run.viewport: 940x820
run.note: replays only — no model calls, no cost. It ENDS on a deliberate miss: the guard re-points at a product that does not exist, and the failed tool call is the point. Say so before you run it.
---

# One recording, three different jobs

**Nothing was built for this.** The trace already had to be a complete account
of what the model saw — that is the invariant the whole request pane rests on.
Once it is, replay falls out of it: re-execute the actions, skip the model.

The recording knows what it was **about**. `session.params` says
`item: "Titanium Tent Stakes"` — so a replay can find that value in what the
run actually did, and swap it.

| item | turns | model calls | cost | cart |
| --- | --- | --- | --- | --- |
| Titanium Tent Stakes *(recorded live)* | 2 | 2 | $0.0062 | ✓ |
| Camp Stove | 2 | **0** | **$0.0000** | ✓ |
| Packraft | 2 | **0** | **$0.0000** | ✓ |
| Dry Bag 20L | 2 | **0** | **$0.0000** | ✓ |

**Three different carts, one paid decision.** This is the difference between a
recording and a video.

It works because of what got captured alongside the click — the ids on the
right are resolved against the page as it is *now*:

```
recorded  click { elementId: 2 }
  argSources.elementId = dom
    "button|Add Titanium Tent Stakes to cart"

replayed  "…Add Camp Stove to cart"  → [3]
          "…Add Packraft to cart"    → [11]
          "…Add Dry Bag 20L to cart" → [10]
```

A recording that stored only `elementId: 2` would be re-runnable exactly once,
on a page that had not moved. Store **what the element was** and the same
recording runs wherever the equivalent element exists.

## And it ends by failing on purpose

The last thing this demo does is re-point at **Hydraulic Press 9000**, which
the shop does not sell. The selector matches nothing, the element id resolves
to `-1`, and the tool refuses the call:

```
No element [-1] in the latest
CURRENT STATE block.
```

**That red line is the feature.** A replay that fell back to the recorded
`elementId: 2` would click whatever now sits in position 2, succeed, and put
the wrong thing in the cart — a confident wrong answer instead of an error.
The cart is left empty, and the run says so.

> Two things this deliberately does not do. It refuses values under three
> characters — substituting "a" everywhere is not a feature. And it never
> rewrites the completion summary: that sentence came from a model that isn't
> running, and swapping the name in would leave the recorded run's *price*
> inside a fluent, wrong sentence. **Judge a re-pointed replay by the world it
> leaves behind.**
