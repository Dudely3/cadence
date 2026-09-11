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
run.note: replays only — no model calls, no API key, no cost
---

# One recording, three different jobs

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

> Two things this deliberately does not do. It refuses values under three
> characters — substituting "a" everywhere is not a feature. And it never
> rewrites the completion summary: that sentence came from a model that isn't
> running, and swapping the name in would leave the recorded run's *price*
> inside a fluent, wrong sentence. **Judge a re-pointed replay by the world it
> leaves behind.**
