---
sessions: sess_mtyus7an_1, sess_mtyushk9_2, sess_mtyusqcl_3, sess_mtyusy0t_4
---

# Where each rung's tokens came from

| rung | fresh (1x) | cache read (0.1x) | cache **write** (1.25x) | cost |
| --- | --- | --- | --- | --- |
| 1. naive | **9** | 102,054 | **97,021** | $0.1346 |
| 2. + volatile tail | **60,936** | 5,170 | 5,580 | $0.0714 |
| 3. + cleaned page | 27,088 | 10,340 | 411 | $0.0312 |
| 4. + let it explore | **4,653** | 13,884 | 8,740 | $0.0216 |

Rung 1 pays full price for **nine tokens** — and 1.25x on ninety-seven
thousand. An append-only prompt caches beautifully and *freezes everything it
ever saw*. The discount is real; the bill still grows without limit.

Rung 2 does the right thing — state past the cache line, replaced each turn —
and by definition that moves the expensive part *outside* the prefix, where it
is billed fresh every turn. **That is the trade, stated honestly.** You take it
anyway, because of the next line.

**Rung 1's peak doubles every turn.** 97,024 here; on the real page the next
slide hits the wall for real, with a 232,396-token request the API refuses to
accept. A cache discount on an unbounded prompt is still an unbounded prompt.

> **Careful with rung 1 vs rung 2.** An earlier recording had this pair the
> other way round — rung 2 costing twice rung 1 — because rung 1 finished in
> two turns that day and rung 2 took three. Same code, same page. Whichever
> model takes an extra turn loses, and that swamps the strategy. **Rungs 3 and
> 4 beat both in every run**; that part is structural, and it is the claim to
> make.
