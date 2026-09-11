---
sessions: sess_mtpzh925_1
run.label: run rung 4 live
run.script: examples/ladder.ts
run.args: --scenario shop --rung 4
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung, Haiku, about 2 cents
---

# Rung 4 — let the model explore

**2,500 characters of page · 30 elements listed · `find_in_page`**

| turns | peak prompt | total prompt | cost |
| --- | --- | --- | --- |
| 3 | **9,430** | **25,498** | **$0.0149** |

Stop shipping the page. Send a small window of it and a tool that searches the
rest. The model asks for what it needs instead of being handed everything in
advance — which is what a person does with a long page.

**5,016 tokens billed fresh; 17,773 read from cache.** With the page gone from
the prompt, what is left is mostly the stable prefix — so most of this run is
paid for at a tenth of list price.

**The honest catch:** this rung is the one that gets things subtly wrong. It
sees a window around a match, and a window can straddle two entries. On the
real page it once reported the right session title with the *next* session's
speaker — a confident near-miss, which is the most expensive kind of error
because it looks like success.

> Three things make this rung work, all three found by watching it fail: every
> element stays addressable even when only 30 are listed; the preview shows the
> **head and the tail** of the page; and every search hit says which section it
> was found under.
