---
sessions: sess_mtyusqcl_3, sess_mtyusy0t_4
---

# Do it right, get nothing

**Below a minimum prefix length nothing caches at all — and good context
construction walks straight under it.**

The whole discipline is to keep bulk *out* of the frozen prefix, which leaves
the prefix small. Measured on this repo's ladder, before anything was done
about it:

| | frozen prefix | cached? |
| --- | --- | --- |
| naive (page frozen into history) | 61,858 tok | ✓ |
| volatile tail | 941 tok | ✗ |
| cleaned page | 1,483 tok | ✗ |
| let it explore | 1,897 tok | ✗ |

**The bloated prompt was the only one caching.** Every well-built one paid full
price on every token of every turn — no error, no warning, just
`cache_read_input_tokens: 0` forever.

**So the fix is counter-intuitive: make the constant part bigger.** A real
operating guide in the system prompt and a full tool surface took the prefix
from ~900 to **{{prefix_tokens}} tokens** — over the bar, written once, read
back at a tenth of the price on every turn after.

> **The bar is 4,096 tokens on Haiku 4.5, and it is not monotonic** — 512 on
> Opus 5, 1,024 on 4.8, 2,048 on 4.7. The cheap model has the highest one.
>
> **`count_tokens` will lie to you about it.** The API's tool preamble is
> billed but sits outside a prefix cut at the system block, so a prompt it puts
> at 4,233 can still refuse to cache — the cacheable part was ~3,900, under the
> bar by 190, silent as ever. Put the line on the goal instead, as **Putting
> the lines in** does, and those tokens count toward clearing it.
>
> Live, from the trace beside this: **{{cache_read}}** read from cache,
> **{{fresh_input}}** billed fresh. `npm run floor` warns when the margin is
> one reworded sentence from dropping under, and the anatomy pane turns the
> cache line amber wherever it happened — true of 48 turns in this repo.
