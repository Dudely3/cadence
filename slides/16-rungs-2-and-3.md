---
sessions: sess_mtyushk9_2, sess_mtyusqcl_3
run.label: run rung 3 live
run.script: examples/ladder.ts
run.args: --scenario shop --rung 3
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung, Haiku, about 5 cents
---

# Rungs 2 and 3 — move the line, then drop the markup

| rung | | turns | peak | total | cost |
| --- | --- | --- | --- | --- | --- |
| 2 | raw DOM, volatile tail | 2 | 36,060 | 71,686 | $0.0714 |
| 3 | cleaned text, volatile tail | 2 | **19,137** | 37,839 | **$0.0312** |

**Rung 2 — state stops being *history* and becomes *the tail*.** Written after
the last breakpoint, thrown away next turn. What stays frozen is the brief
outcome of each action: what was called, what came back. **97,024 → 36,060 in
the biggest request**, with nothing summarised and nothing hidden. The page is
still there in full. It just isn't there twice.

**And look what it did to the price of a token.** 60,936 billed fresh, against
rung 1's **nine**. Moving the page past the cache line is the correct decision,
and it moved the page from 0.1x to 1.0x. Two true things collided there, and a
slide that showed only one of them would be selling you something.

| rung | fresh (1x) | cache read (0.1x) | cache **write** (1.25x) |
| --- | --- | --- | --- |
| 1. naive | **9** | 102,054 | **97,021** |
| 2. + volatile tail | **60,936** | 5,170 | 5,580 |
| 3. + cleaned page | 27,088 | 10,340 | 411 |

Rung 1 pays full price for nine tokens and 1.25x on ninety-seven thousand. An
append-only prompt caches beautifully and *freezes everything it ever saw*.
**You take rung 2's trade anyway, because rung 1's peak doubles every turn** —
and a cache discount on an unbounded prompt is still an unbounded prompt.

**Rung 3 — tags, classes, wrappers, inline styles, script and style bodies.**
The model was never reading any of it. Headings become `#`, adjacent duplicates
collapse, hidden nodes disappear. **36,060 → 19,137, less than half rung 2's
cost** — and these two differ in *exactly one thing*: markup versus text. Same
mode, same tools, same cache layout, same goal.

That saving is not a caching trick. It is **fewer bytes** — which is why it
holds on any model, at any prefix length, with no floor to clear and nothing to
tune.

> Both recordings are bound here. Click a state block on rung 2, then the same
> block on rung 3, and read what actually goes to the model in each.
