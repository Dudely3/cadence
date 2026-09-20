---
sessions: sess_mtyusqcl_3, sess_mtyv3tns_3
run.label: run rung 3 on the shop
run.script: examples/ladder.ts
run.args: --scenario shop --rung 3
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung on the local page, Haiku, about 5 cents
run2.label: run rung 3 on prairiedevcon
run2.script: examples/ladder.ts
run2.args: --scenario pdc --rung 3
run2.step: true
run2.headed: true
run2.viewport: 940x820
run2.note: hits the live site and needs the network — about 3 cents
---

# Rung 3 — drop the markup

**Tags, classes, wrappers, inline styles, script and style bodies.** The model
was never reading any of it. Headings become `#`, adjacent duplicates collapse,
hidden nodes disappear.

| | turns | peak prompt | cost | |
| --- | --- | --- | --- | --- |
| **shop** | 2 | 19,137 | $0.0312 | right cart ✓ |
| **prairiedevcon** | 1 | 25,886 | $0.0242 | **completed** ✓ |

**36,060 → 19,137**, and the cache-write column falls from rung 2's 5,580
tokens to **411**: the first rung that is cheaper *and* smaller.

Rungs 2 and 3 differ in **exactly one thing** — markup versus text. Same mode,
same tools, same cache layout, same goal. That saving is not a caching trick,
it is **fewer bytes**, which is why it holds on any model, at any prefix
length, with nothing to tune.

## This is where the real page starts working

Same tools and the same goal as rung 2, which narrated and gave up. Rung 3 got
the session and its speaker **in a single turn for two cents.** The only
difference between them is markup versus cleaned text.

**That is the whole rung.** No search tool, no windowing, no cleverness — just
not sending the model 76,000 tokens of `<div>`.

> Both recordings are bound here. Click a state block on rung 2, then the same
> block on rung 3, and read what actually goes to the model in each.
