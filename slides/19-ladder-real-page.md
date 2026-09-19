---
sessions: sess_mtyv39r1_1, sess_mtyv3kwm_2, sess_mtyv3tns_3, sess_mtyv43le_4
run.label: run the ladder on prairiedevcon.com
run.script: examples/ladder.ts
run.args: --scenario pdc
run.step: false
run.headed: false
run.note: needs the network and hits a live site; about 35 cents, two thirds of it in the rung that walks into the context window
---

# The same ladder, on a real page

prairiedevcon.com — 76K tokens of raw DOM. Find a session and its speaker.

| rung | turns | peak prompt | cost | right? | outcome |
| --- | --- | --- | --- | --- | --- |
| 1. naive | 3 | 156,449 | $0.2044 | ✗ | **error** |
| 2. + volatile tail | 1 | 79,748 | $0.0830 | ✗ | **stopped** |
| 3. + cleaned page | 1 | 25,886 | $0.0242 | ✓ | completed |
| 4. + let it explore | 3 | **7,352** | **$0.0147** | ✓ | completed |

On the local page bad context construction costs money. **Here it stops
working**, and the two that fail are the two that were fine a slide ago.

**Rung 1 walked into the wall.** Turn 2's request was never sent:

```
400 invalid_request_error
prompt is too long:
232396 tokens > 200000 maximum
```

Two turns of freezing a 76K-token page into history, and the third request
could not exist. Not a timeout, not a bad answer — the run had nowhere left to
put the page it insisted on keeping.

**Rung 2 narrated instead of acting.** One turn, 79,748 tokens, and it wrote
*"let me search through the schedule content"* — then **called no tool at all.**
It has no search tool; that arrives at rung 4. Its page was also cut at 200,000
characters, so the answer may not have been in the prompt to find.

**Rung 3 got it in a single turn for two cents**, on the same tools and the same
goal as rung 2. The only difference is markup versus cleaned text.

**Rung 4 got it in three for one and a half cents** — and asked for what it
needed instead of being handed the site.

> Rung 2 threw nothing. It reported `stopped`, and a caller checking only for
> exceptions saw a clean run. Rung 1 did throw — but for running out of window,
> not for being wrong. Neither failure is visible from the outcome alone, which
> is the whole reason to look at the context.
