---
sessions: sess_mtyushk9_2, sess_mtyv3kwm_2
---

# Put the volatile stuff past the line

**That is the move rung 2 just made. Here is the rule it was obeying.** The
prefix must be byte-identical to be reused, so anything that changes every turn
has to live *after* the last breakpoint.

- **Before the line:** tools, system prompt, frozen turn history
- **After the line:** current page state, plan progress, critic feedback

**This run:** volatile tail ≈ **{{tail_tokens}} tokens**, re-sent every single
turn and never cached.

> The Solo bug that makes this real: human-in-the-loop observation messages were
> joined into the prompt *before* the cache line. Prompt caching silently
> switched off — a UX feature destroyed the cache purely by landing on the wrong
> side of a boundary.
