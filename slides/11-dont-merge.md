# Don't merge history to be clever

The 20-position lookback tempts an obvious optimization: stop appending blocks,
and keep the whole conversation in **one text block** you rewrite each turn.

It destroys the conversation cache. Measured, same four turns, both ways:

| turn | **A** append: read | **B** merge: read | **B** merge: write |
| --- | --- | --- | --- |
| 0 | 0 (cold) | 4,360 | 12 |
| 1 | **4,370** | 4,360 | 31 |
| 2 | **4,384** | 4,360 | 49 |
| 3 | **4,397** | 4,360 | 71 |

- **A** reads back everything so far and writes only the delta — 14, 13, 17 tokens.
- **B** is pinned at 4,360 forever. That is the *system prompt* alone. The history
  is never read back, and the write column grows as it re-pays for bytes it will
  never reuse.

**Why:** the cache is a prefix match on bytes. A merged block's bytes change
every turn, so the match ends where that block begins. Appending leaves earlier
blocks untouched, which is the only reason they can be reused.

> Run it yourself: `npm run cachelab` — two real four-turn conversations, the
> usage numbers printed side by side. The fix for a long turn is an extra
> breakpoint, never fewer blocks.
