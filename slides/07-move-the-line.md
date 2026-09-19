---
sessions: sess_mtyqcsi4_1
---

# Move the line every turn

**A breakpoint set once stops working after about ten turns, and nothing tells
you.**

Each breakpoint walks backward at most **20 positions** looking for a prior
entry. Past that it misses: `cache_read: 0`, the whole prefix written again at
1.25×, no error. Measured on Haiku 4.5, same prefix each time, only the
distance changing:

| gap between prefix and breakpoint | msgs | blocks | |
| --- | --- | --- | --- |
| 10 turns, 1 tool each | 20 | 20 | hit |
| 11 turns, 1 tool each | 22 | 22 | **miss** |
| 4 turns, 10 tools each | 8 | 80 | hit |
| 10 turns, 6 tools each | 20 | **120** | hit |
| 11 turns, 6 tools each | 22 | 132 | **miss** |

**Positions, not blocks.** A run of consecutive `tool_use` blocks counts as
one, and so does a run of `tool_result` — which is why 120 blocks inside 20
messages hits and 22 blocks in 22 messages does not. An agent turn is two
messages. Twenty positions is ten turns.

```js
// every turn, on the newest closed turn
const last = blocks.at(-1);
last.cache_control = { type: "ephemeral" };
```

## And no, you can't dodge it by merging

**The tempting fix — keep the conversation in one block you rewrite each turn —
throws away everything behind it.** Same four turns, both ways:

| turn | **A** append: read | **B** merge: read | **B** merge: write |
| --- | --- | --- | --- |
| 0 | 0 (cold) | 4,360 | 12 |
| 1 | **4,370** | 4,360 | 31 |
| 2 | **4,384** | 4,360 | 49 |
| 3 | **4,397** | 4,360 | 71 |

**B** is pinned at 4,360 forever — that is the *system prompt* alone. A merged
block's bytes change every turn, so the match ends where that block begins.
Appending leaves earlier blocks untouched, which is the only reason they can be
reused.

**A "clean up the history" feature added later is a cache-invalidation bug
wearing a nice hat.**

> **Also true, if it comes up.** What you read *back* is unbounded — an
> 11,044-token prefix from sixty messages ago returns in full. Dropping an
> older line costs nothing: `cache_control` says where to **write**, not what
> to read. The bug's signature is byte-identical payloads that still rewrite
> everything, `cache_creation_input_tokens` near full size every request. In a
> turn long enough to append twenty positions of its own, add an intermediate
> breakpoint around fifteen.
>
> And you may shape history however you like *before* it is cached — drop
> blocks, rewrite them, summarize them. Once a prefix is cached, editing inside
> it breaks the cache from that point forward. Decide the shape, then cache it.
>
> `npm run cachelab` runs both conversations against the real API and prints
> the usage side by side.
