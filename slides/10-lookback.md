# The 20-block lookback

Each breakpoint walks backward **at most 20 positions** looking for a prior
cache entry. Past that, it silently misses.

- A run of consecutive `tool_use` blocks counts as **one** position.
- So does a run of consecutive `tool_result` blocks.
- A turn that appends more than 20 positions of *other* content pushes the
  previous entry out of the window.

**Fix:** place an intermediate breakpoint roughly every 15 positions in long
turns.

**The signature of this bug:** byte-identical payloads that still rewrite the
whole conversation every request — `cache_creation_input_tokens` near the full
size, every time.

> The tempting fix — merging turns into fewer blocks — is the wrong one. Next
> slide shows what it actually costs.
