---
sessions: sess_mtyqcsi4_1
---

# Put the volatile stuff past the line

The prefix must be byte-identical to be reused. So anything that changes every
turn has to live *after* the last breakpoint.

- **Before the line:** tools, system prompt, frozen turn history
- **After the line:** current page state, plan progress, critic feedback

**This run:** volatile tail ≈ **{{tail_tokens}} tokens**, re-sent every single
turn and never cached.

> The Solo bug that makes this real: human-in-the-loop observation messages were
> joined into the prompt *before* the cache line. Prompt caching silently
> switched off — a UX feature destroyed the cache purely by landing on the wrong
> side of a boundary.
