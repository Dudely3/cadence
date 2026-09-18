---
sessions: sess_mu2rtogv_3, sess_mu2rvrqs_4
run.label: run the audit on speed
run.script: examples/compare.ts
run.args: --goals e --modes speed
run.step: false
run.headed: false
run.note: one Haiku run on the audit page — about four cents
---

# History remembers. The state block doesn't.

A task built so that carrying state forward is the only way through. Six
returned units, and **none of them can be judged until all six are inspected.**
A unit's condition appears only in a detail pane that holds one unit and is
overwritten by the next inspection.

That pane is part of the **state block** — which this harness replaces every
turn. So by the time the first disposition is legal, five of the six conditions
are no longer anywhere in the request.

## Both modes got it right. Only one of them remembered.

| | speed | accuracy |
| --- | --- | --- |
| clean audits | 3/3 | 3/3 |
| turns | 14, 15, 18 | 20, 20, 21 |
| **inspections** | **6, 6, 9** | **12, 12, 12** |
| cost each | $0.041 | **$0.546** |

**Speed**, the turn the lock opened — *"here's what I found:"*

```
- RU-101: intact  → Restock
- RU-102: damaged → Scrap
- RU-103: damaged → Scrap
- RU-104: intact  → Restock
- RU-105: damaged → Scrap
- RU-106: intact  → Restock
```

It wrote the ledger into its own reasoning, and **assistant text is frozen
prefix.** It re-read that list every later turn and never opened the pane
again. Fourteen turns, three and a half cents.

**Accuracy**, same turn, same page:

> All six are inspected, but the pane shows only the most recent one. I only
> reliably know RU-106 is intact (from this state block). My earlier notes were
> assumptions, not verified from state.

Then it re-inspected all six. **13× the price for the same clean audit.**

> Nobody told the cheap model to do that. It used the *shape* of the prompt —
> history frozen, state volatile — as somewhere to put a fact it would need
> later. That is **Put the volatile stuff past the line** and **Stable, not
> identical** arriving from the other direction, chosen by the model rather
> than designed by me.
>
> **Two honest caveats.** This page was redesigned until it had that property;
> the first version let the model inspect and judge one unit at a time, and
> tracking never mattered. And this is the fifth purpose-built trap in this
> repo that failed to catch the cheap mode. The only one that ever did is the
> previous slide, and it hid the **path**, not the facts.
>
> So the honest answer to "what does accuracy buy?" is narrower than the
> brochure: on work this size, sometimes it buys the model deciding not to
> trust itself.
