---
sessions: sess_mtyusqcl_3, sess_mtyusy0t_4
---

# The floor nobody mentions

There is a **minimum cacheable prefix**. Below it, nothing caches — no error,
no warning, just `cache_read_input_tokens: 0` forever.

| Model | Minimum |
| --- | --- |
| Opus 5 | 512 tokens |
| Opus 4.8 | 1,024 |
| Opus 4.7 | 2,048 |
| **Haiku 4.5** | **4,096** |

It is **not monotonic across generations**. The cheap model has the highest bar.

**And good context construction walks straight into it.** The whole discipline
is to keep bulk *out* of the frozen prefix — which leaves the prefix small.
Measured on this repo's ladder before anything was done about it:

| | frozen prefix | cached? |
| --- | --- | --- |
| naive (page frozen into history) | 61,858 tok | ✓ |
| volatile tail | 941 tok | ✗ |
| cleaned page | 1,483 tok | ✗ |
| let it explore | 1,897 tok | ✗ |

The bloated prompt was the only one caching. Every well-built one paid full
price on every token of every turn.

**The fix is counter-intuitive: make the constant part bigger.** A real
operating guide in the system prompt and a full tool surface took the prefix
from ~900 to **{{prefix_tokens}} tokens** — over the floor, written once, and
read back at a tenth of the price on every turn after.

**And `count_tokens` will lie to you about it.** The tool preamble the API adds
does not sit inside a prefix cut at the system block, so it does not count
toward the floor either. Measured: a prompt `count_tokens` put at 4,233 refused
to cache on Haiku — the cacheable part was ~3,900 once the preamble was
excluded, under the bar by 190, silent as ever. Put the line on the goal
instead, as **Putting the lines in** does, and those tokens count toward
clearing it.

> Live, from the trace open beside this: **{{cache_read}} tokens** read from
> cache, **{{fresh_input}}** billed fresh.
>
> `npm run floor` measures any recording's prefix against the floor, and warns
> when the margin is thin enough that one reworded sentence would drop it under.
> The anatomy pane says it too, wherever it happened: the cache line turns amber
> and reads *"breakpoint sent — and ignored"* rather than claiming a frozen
> prefix. That is true of 48 turns across the recordings in this repo.
