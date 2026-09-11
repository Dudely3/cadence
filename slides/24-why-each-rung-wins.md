---
sessions: sess_mtpzblz6_1, sess_mtpzbuj8_2, sess_mtpzc5h6_3, sess_mtpzh925_1
---

# Why rung 2 costs twice as much

Where each rung's tokens actually came from:

| rung | fresh (full price) | cache read (0.1x) | cost |
| --- | --- | --- | --- |
| 1. naive | **6** | 71,286 | $0.0486 |
| 2. + volatile tail | **91,762** | 15,072 | $0.0980 |
| 3. + cleaned page | 40,994 | 15,077 | $0.0464 |
| 4. + let it explore | **5,016** | 17,773 | $0.0149 |

Rung 1 pays full price for **six tokens**. Its prompt is append-only, so every
turn re-reads the last one at a tenth of the price. Rung 2 does the right thing
— state past the cache line, replaced each turn — and by definition the
expensive part is now *outside* the cached prefix, where it is billed fresh
every single turn.

**That is the trade, stated honestly.** Putting volatile content past the cache
line is correct, and it moves that content from 0.1x to 1.0x. You do it anyway,
because of what the next line says.

**Rung 1's peak doubles every turn.** 66,533 on turn 2 here; 150,772 on the real
page; a hard wall a turn or two later. A cache discount on an unbounded prompt
is still an unbounded prompt, and the discount does not save you from the
context window.

> Rung 3 is where the money argument comes back — and for a different reason.
> Not better caching. Fewer bytes.
