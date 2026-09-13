---
sessions: sess_mtyqcsi4_1
---

# Stable, not identical

A common misreading: "every block must be the same every time."

What actually matters is narrower. **The overlap between consecutive requests
must be byte-identical up to the breakpoint.**

- You may shape history however you like *before* it gets cached — drop blocks,
  rewrite them, summarize them.
- Once a prefix is cached, editing anything inside it breaks the cache from that
  point forward.
- So: decide the shape, *then* cache it. Not the other way around.

> Practical consequence: a "clean up the history" feature added later is a
> cache-invalidation bug wearing a nice hat.
