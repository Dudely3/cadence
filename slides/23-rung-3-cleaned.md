---
sessions: sess_mtyusqcl_3
run.label: run rung 3 live
run.script: examples/ladder.ts
run.args: --scenario shop --rung 3
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung, Haiku, about 5 cents
---

# Rung 3 — clean the page

**Cleaned text · volatile tail · same everything else**

| turns | peak prompt | total prompt | cost |
| --- | --- | --- | --- |
| 2 | 19,137 | 37,839 | $0.0312 |

Tags, classes, wrappers, inline styles, script and style bodies. The model was
never reading any of it. Headings become `#`, adjacent duplicates collapse,
hidden nodes disappear.

**36,060 → 19,137, and less than half the cost of rung 2.** Rungs 2 and 3
differ in exactly one thing: markup versus text. Same mode, same tools, same
cache layout, same goal.

The saving here is not a caching trick. It is **fewer bytes** — which is why it
holds on any model, at any prefix length, with no floor to clear and nothing to
tune.

> Click a state block in the anatomy pane and read what actually goes to the
> model now. Then click one on the previous slide's rung and compare.
