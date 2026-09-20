---
sessions: sess_mtyus7an_1, sess_mtyushk9_2, sess_mtyusqcl_3, sess_mtyusy0t_4, sess_mtyv39r1_1, sess_mtyv3kwm_2, sess_mtyv3tns_3, sess_mtyv43le_4
run.label: run the whole ladder
run.script: examples/ladder.ts
run.args: --scenario shop
run.step: false
run.headed: false
run.note: 4 live runs, roughly 25 cents and a few minutes — the per-rung slides run one at a time
---

# The context ladder

Same goal. Same loop. Same page. Same model. Same tools. **Only the context
strategy changes.** All four finish with the correct cart.

Four rungs, each one idea:

- **1 — the obvious way.** Send the DOM, append every turn of it to history,
  put the breakpoint at the end and cache the lot.
- **2 — stop freezing state into history.** Re-observe it, and put it past the
  cache line where it is replaced every turn.
- **3 — drop the markup** the model was never reading.
- **4 — stop shipping the page at all.** Send a small window of it and a tool
  that searches the rest.

Every rung runs twice: once on a **local shop page** I built, and once on
**prairiedevcon.com** — 76K tokens of real DOM that nobody designed for a demo.

**Watch the biggest single request, not the bill.** Cost on a small page comes
down mostly to which run happened to take an extra turn. Peak prompt size does
not move like that — and on the real page it is the number that decides whether
the request can be sent at all.

> `npm run ladder` runs all four on either scenario and writes the traces
> bound to this slide. The next four slides take one rung each, with both of
> its recordings already open.
