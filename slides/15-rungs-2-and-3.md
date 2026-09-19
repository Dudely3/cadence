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

# Rungs 2 and 3 — bound it, then shrink it

**Rung 2 — state stops being *history* and becomes *the tail*.** Re-observed
every turn, written after the last breakpoint, thrown away next turn. What
stays frozen is the brief outcome of each action: what was called, what came
back.

**97,024 → 36,060 in the biggest request**, with nothing summarised and nothing
hidden. The page is still there in full. It just isn't there twice.

## Rung 2 does not save you money. It gives the prompt a ceiling.

| rung | fresh (1x) | cache read (0.1x) | cache **write** (1.25x) | peak |
| --- | --- | --- | --- | --- |
| 1. naive | **9** | 102,054 | **97,021** | 97,024 |
| 2. + volatile tail | **60,936** | 5,170 | 5,580 | **36,060** |
| 3. + cleaned page | 27,088 | 10,340 | **411** | **19,137** |

Rung 1 pays full price for **nine tokens** in an entire run. Moving the page
past the cache line moves it from 0.1× to 1.0×, and rung 2 bills 60,936 fresh
for the privilege. Rung 2 still came out at half rung 1's cost here — but
mostly because it finished in two turns and rung 1 took three. **Between those
two, cost is noise. Peak is not.**

**You take the trade because rung 1 has no ceiling.** Its peak doubles every
turn and rung 2's does not, and a cache discount on an unbounded prompt is
still an unbounded prompt. Two slides from now that stops being an argument
about money.

**Rung 3 — tags, classes, wrappers, inline styles, script and style bodies.**
The model was never reading any of it. Headings become `#`, adjacent duplicates
collapse, hidden nodes disappear. **36,060 → 19,137**, and the write column
falls to 411 tokens: the first rung that is cheaper *and* smaller.

These two differ in **exactly one thing** — markup versus text. Same mode, same
tools, same cache layout, same goal. That saving is not a caching trick, it is
**fewer bytes**, which is why it holds on any model, at any prefix length, with
no floor to clear and nothing to tune.

> Both recordings are bound here. Click a state block on rung 2, then the same
> block on rung 3, and read what actually goes to the model in each.
