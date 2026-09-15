---
sessions: sess_mtyus7an_1, sess_mtpzblz6_1
run.label: run rung 1 live
run.script: examples/ladder.ts
run.args: --scenario shop --rung 1
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung, Haiku, about 5 cents
---

# Rung 1 — the obvious way

**Raw DOM · frozen into history · one breakpoint at the very end**

The page? Send the DOM, tags and all. History? Append every turn's page state
and never remove it. Caching? Put the breakpoint at the end and cache the lot.
Nothing here is stupid — every choice is the conservative one.

| turns | peak prompt | total prompt | cost |
| --- | --- | --- | --- |
| 3 | 97,024 | 199,084 | $0.1346 |

And it *works*. It ends with the right cart, and on a good day it is the
cheapest rung on the board.

**Look at the request beside this slide.** Turn 1 carries the catalogue twice —
as it was at turn 0, and as it is now. One of them is wrong. Both are sent.

| turn | fresh in | cache read | cache write |
| --- | --- | --- | --- |
| 0 | 3 | 0 | 35,643 |
| 1 | 3 | 35,643 | 30,768 |
| 2 | 3 | **66,411** | 30,610 |

**Nine fresh tokens for the whole run** — and note what *isn't* the problem.
Every request is a strict extension of the last, so the previous prompt comes
back at a tenth of the price. An append-only prefix is exactly what caching
likes. The cache is doing its job perfectly. The problem is what you put in it.

> **Turn 0 writes here; the second recording beside this slide read.** A first
> turn can read from cache if another run cached the same prefix inside the TTL
> — which is what happens the moment you run the ladder twice. That one never
> paid to write its own 35,643-token prefix and looked cheaper for it. If you
> are comparing strategies on cost, check whether one of them started warm.

> The tell is never an error. It is a run that works, gets bigger every turn,
> and occasionally acts on a stale snapshot because it had two to choose from.
> It works until the page is real — four slides from here.
