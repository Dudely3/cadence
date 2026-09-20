---
sessions: sess_mtyushk9_2, sess_mtyv3kwm_2
run.label: run rung 2 on the shop
run.script: examples/ladder.ts
run.args: --scenario shop --rung 2
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung on the local page, Haiku, about 5 cents
run2.label: run rung 2 on prairiedevcon
run2.script: examples/ladder.ts
run2.args: --scenario pdc --rung 2
run2.step: true
run2.headed: true
run2.viewport: 940x820
run2.note: hits the live site and needs the network — about 8 cents
---

# Rung 2 — move the line

**State stops being *history* and becomes *the tail*.** Re-observed every turn,
written after the last breakpoint, thrown away next turn. What stays frozen is
the brief outcome of each action: what was called, what came back.

| | turns | peak prompt | cost | |
| --- | --- | --- | --- | --- |
| **shop** | 2 | 36,060 | $0.0714 | right cart ✓ |
| **prairiedevcon** | 1 | 79,748 | $0.0830 | **stopped** |

**97,024 → 36,060 in the biggest request**, with nothing summarised and nothing
hidden. The page is still there in full. It just isn't there twice.

## It does not save you money. It gives the prompt a ceiling.

| rung | fresh (1x) | cache read (0.1x) | cache **write** (1.25x) | peak |
| --- | --- | --- | --- | --- |
| 1. naive | **9** | 102,054 | **97,021** | 97,024 |
| 2. + volatile tail | **60,936** | 5,170 | 5,580 | **36,060** |

Rung 1 pays full price for **nine tokens** in an entire run. Moving the page
past the cache line moves it from 0.1× to 1.0×, and rung 2 bills 60,936 fresh
for the privilege. It still came out at half rung 1's cost here — but mostly
because it finished in two turns and rung 1 took three. **Between those two,
cost is noise. Peak is not.**

**You take the trade because rung 1 has no ceiling.** Its peak doubles every
turn and rung 2's does not, and a cache discount on an unbounded prompt is
still an unbounded prompt.

## On the real page it narrated instead of acting

One turn, 79,748 tokens, and it wrote *"let me search through the schedule
content"* — then **called no tool at all.** It has no search tool; that arrives
at rung 4. Its page was also cut at 200,000 characters, so the answer may not
have been in the prompt to find.

> **It threw nothing.** It reported `stopped`, and a caller checking only for
> exceptions saw a clean run. Rung 1 at least crashed. Neither failure is
> visible from the outcome alone, which is the whole reason to look at the
> context.
