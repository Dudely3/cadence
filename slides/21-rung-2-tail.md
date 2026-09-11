---
sessions: sess_mtpzbuj8_2
run.label: run rung 2 live
run.script: examples/ladder.ts
run.args: --scenario shop --rung 2
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung, Haiku, about 10 cents
---

# Rung 2 — move the cache line back

**Raw DOM · state on a volatile tail · replaced every turn**

| turns | peak prompt | total prompt | cost |
| --- | --- | --- | --- |
| 3 | 36,077 | 107,626 | **$0.0980** |

One change: state stops being *history* and becomes *the tail*. It is written
after the last breakpoint and thrown away next turn. What stays frozen is only
the brief outcome of each action — what was called, what came back.

**66,533 → 36,077 in the biggest request.** Nothing was summarised and nothing
was hidden from the model. The current page is still there in full. It just
isn't there twice.

**And it costs twice what rung 1 cost.** 91,762 tokens billed fresh, against
rung 1's six. Moving the page past the cache line is the correct decision and
it moved the page from 0.1x to 1.0x.

> Two true things collided here, and a slide that showed only one of them would
> be selling you something. Next slide.
