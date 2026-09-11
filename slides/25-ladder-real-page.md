---
sessions: sess_mtpzdcmo_1, sess_mtpzdq4h_2, sess_mtpzemit_3, sess_mtpzglcz_1
run.label: run the ladder on prairiedevcon.com
run.script: examples/ladder.ts
run.args: --scenario pdc
run.step: false
run.headed: false
run.note: needs the network and hits a live site; about 90 cents, two thirds of it in the rung that never finishes
---

# The same ladder, on a real page

prairiedevcon.com — 76K tokens of raw DOM. Find a session and its speaker.

| rung | turns | peak prompt | cost | right? | outcome |
| --- | --- | --- | --- | --- | --- |
| 1. naive | 2 | 150,772 | $0.1985 | ✗ | **stopped** |
| 2. + volatile tail | 8 | 80,293 | $0.6088 | ✗ | **max steps** |
| 3. + cleaned page | 4 | 25,057 | $0.0839 | ✓ | completed |
| 4. + let it explore | 3 | **7,308** | **$0.0089** | ✓ | completed |

On the local page bad context construction costs money. **Here it stops
working**, and the two that fail are the two that were fine a slide ago.

**Rung 1 stopped talking.** Turn 1's prompt was 150,772 tokens. It wrote *"Let
me look through the session titles systematically…"* and then **called no tool
at all.** Not an error — the model narrated an intention and the loop had
nothing to execute.

**Rung 2 spent 61 cents going nowhere.** Eight turns, 588,399 tokens billed
fresh, saying *"let me search through the sessions"* over and over. It has no
search tool. Neither rung does — that arrives at rung 4.

**Rung 3 got it in four turns for eight cents**, on the same tools and the same
goal. The only difference from rung 2 is markup versus cleaned text.

**Rung 4 got it in three, for less than a cent** — 22x cheaper than rung 3 and
20x cheaper than rung 1.

> Neither failure threw. Neither timed out. Rung 1 reported `stopped` and rung 2
> `max_steps`, and a caller checking only for exceptions would have seen a clean
> run twice. That is the whole reason to look at the context instead of the
> outcome.
