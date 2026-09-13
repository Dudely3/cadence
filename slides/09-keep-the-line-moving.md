---
sessions: sess_mtyqcsi4_1
---

# The cache line has to keep moving

Two limits live here. Only one of them bites.

**What you read back is unbounded.** A 60-message, 11,044-token prefix read back
in full from a breakpoint two messages later. No cap on how much, or how far
back, or how old.

**The gap is capped at 20 messages.** Measured on Haiku 4.5, same prefix each
time, only the distance changing:

| gap between prefix and breakpoint | msgs | blocks | |
| --- | --- | --- | --- |
| 10 turns, 1 tool each | 20 | 20 | hit |
| 11 turns, 1 tool each | 22 | 22 | **miss** |
| 4 turns, 10 tools each | 8 | 80 | hit |
| 10 turns, 6 tools each | 20 | **120** | hit |
| 11 turns, 6 tools each | 22 | 132 | **miss** |

**Messages, not blocks.** A hundred and twenty content blocks inside twenty
messages still hits. Twenty-two blocks in twenty-two messages does not.

**And you do not degrade, you fall off.** `cache_read: 0`, and the entire prefix
is written again at 1.25x. Nothing in the response says it happened.

An agent turn is **two** messages — the calls, then their results. So a
breakpoint set once and never moved stops working after about ten turns.

```js
// every turn, on the newest closed turn
const last = blocks.at(-1);
last.cache_control = { type: "ephemeral" };
```

> Dropping an older line costs nothing. `cache_control` says where to **write**,
> not what to read: turn 1 with the system line removed read 8,982 and wrote
> zero, identical to keeping it. The entry lives until its TTL, marked or not.
