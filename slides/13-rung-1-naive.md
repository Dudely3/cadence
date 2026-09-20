---
sessions: sess_mtyus7an_1, sess_mtyv39r1_1
run.label: run rung 1 on the shop
run.script: examples/ladder.ts
run.args: --scenario shop --rung 1
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung on the local page, Haiku, about 5 cents
run2.label: run rung 1 on prairiedevcon
run2.script: examples/ladder.ts
run2.args: --scenario pdc --rung 1
run2.step: true
run2.headed: true
run2.viewport: 940x820
run2.note: hits the live site and needs the network — about 12 cents — this is the one that walks into the wall
---

# Rung 1 — the obvious way

**Raw DOM · frozen into history · one breakpoint at the very end**

The page? Send the DOM, tags and all. History? Append every turn's page state
and never remove it. Caching? Put the breakpoint at the end and cache the lot.
Nothing here is stupid — every choice is the conservative one.

| | turns | peak prompt | cost | |
| --- | --- | --- | --- | --- |
| **shop** | 3 | 97,024 | $0.1346 | right cart ✓ |
| **prairiedevcon** | 3 | 156,449 | $0.2044 | **error** |

**Look at the shop request.** Turn 1 carries the catalogue twice — as it was at
turn 0, and as it is now. One of them is wrong. Both are sent.

| turn | fresh in | cache read | cache write |
| --- | --- | --- | --- |
| 0 | 3 | 0 | 35,643 |
| 1 | 3 | 35,643 | 30,768 |
| 2 | 3 | **66,411** | 30,610 |

**Nine fresh tokens for the whole run** — and note what *isn't* the problem.
Every request is a strict extension of the last, so the previous prompt comes
back at a tenth of the price. An append-only prefix is exactly what caching
likes. The cache is doing its job perfectly. The problem is what you put in it.

## And then the page is real

On a 76K-token site, turn 2's request was **never sent**:

```
400 invalid_request_error
prompt is too long:
232396 tokens > 200000 maximum
```

Two turns of freezing the page into history, and the third request could not
exist. Not a timeout, not a wrong answer — the run had nowhere left to put the
page it insisted on keeping. **It threw, but for running out of window, not for
being wrong.**

> The tell is never an error, right up until it is. On the shop page this is a
> run that works, gets bigger every turn, and occasionally acts on a stale
> snapshot because it had two to choose from.
>
> **Turn 0 writes here.** A first turn can read from cache if another run
> cached the same prefix inside the TTL — which happens the moment you run the
> ladder twice, and that run looks cheaper for it. If you are comparing
> strategies on cost, check whether one of them started warm.
